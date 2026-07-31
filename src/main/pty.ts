import { app, ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { execFile, execFileSync } from 'child_process'
import type { PtyCreateOptions } from '../shared/types'
import { mcpEnv } from './mcpBridge'
import { secretsEnv, noteInjected } from './secrets'

interface Entry {
  pty: pty.IPty
  wcId: number
}

const ptys = new Map<string, Entry>()
let nextId = 1

function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

// 「跳出的网页默认用画板内嵌浏览器」的最后一环：终端里的 CLI(如 AI 工具)常直接调
// macOS 的 `open <url>` 打开系统浏览器(Safari)——那是子进程直接找系统，前端拦不到。
// 这里在 userData 放一个 shim `open`，把它的目录塞到 PTY 的 PATH 最前：
//   · 参数是 http(s) 网址 → 写进一个「待打开」文件，主进程监听后在画板浏览器打开；
//   · 其它参数(开文件/开 app) → 原样转发给真正的 /usr/bin/open。
// 同时设 BROWSER，照顾按 xdg/BROWSER 约定的工具。
let shimDirCache: string | null = null
const urlQueueFile = (): string => path.join(app.getPath('userData'), 'open-url.queue')

// 同一个 shim 目录还放 claude / codex 的包装脚本（见 mcpBridge.ensureAgentShims），
// 让 app 内起的 AI CLI 自动带上画板 MCP —— 所以这里 win32 之外都要建目录，不再只给 darwin。
function ensureOpenShim(): string | null {
  if (process.platform === 'win32') return null
  if (shimDirCache) return shimDirCache
  try {
    const dir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(dir, { recursive: true })
    const shim = path.join(dir, 'open')
    const script = `#!/bin/sh
# Eas-Term: 把 open <url> 劫持到画板内嵌浏览器；其它参数转发系统 open
for a in "$@"; do
  case "$a" in
    http://*|https://*)
      printf '%s\\n' "$a" >> "${urlQueueFile()}"
      exit 0
      ;;
  esac
done
exec /usr/bin/open "$@"
`
    fs.writeFileSync(shim, script, { mode: 0o755 })
    fs.chmodSync(shim, 0o755)
    shimDirCache = dir
    return dir
  } catch (e) {
    console.error('[pty] 创建 open shim 失败(终端链接将回落系统浏览器)', e)
    return null
  }
}

/**
 * `eas-secret` 包装命令。解决的是一个硬约束：
 * **进程的环境变量在 spawn 那一刻就定死了** —— 用户后来才存进密钥柜的东西，
 * 已经在跑的这个终端永远读不到。原来只能让 agent 去开个新终端，手上的活就断了。
 *
 *   eas-secret run --group "AWS 生产账号" -- aws s3 ls
 *
 * 值由 shim 向主进程现取，直接放进子进程的 env。三个关键性质：
 *   · 明文不经 stdout —— agent 看到的只有被包裹命令自己的输出
 *   · 明文不进 shell history / ps —— 命令行里只有**组名**，没有值
 *   · 要解锁态才给（比 PTY 注入还紧一档，见 secretsForRun）
 *
 * 它**不**让 agent 更"看不见"密钥（真想看，包一个 `env` 就露了），
 * 它买的是可用性：不用中断、不用开新终端。这一点别在文案里说反。
 *
 * 跟 open shim 一样塞在 PATH 最前。`eas-secret` 是个新名字，
 * 就算被用户 .zshrc 的 PATH 改动挤到后面也无所谓 —— 不会有第二个同名命令。
 */
let secretShimCache: string | null = null
function ensureSecretShim(): string | null {
  if (secretShimCache) return secretShimCache
  try {
    const dir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(dir, { recursive: true })
    const js = app.isPackaged
      ? path.join(process.resourcesPath, 'mcp', 'eas-secret.mjs')
      : path.join(app.getAppPath(), 'mcp', 'eas-secret.mjs')
    if (process.platform === 'win32') {
      // Windows 侧：.cmd 才会被 PATH 查找命中
      fs.writeFileSync(
        path.join(dir, 'eas-secret.cmd'),
        `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${js}" %*\r\n`
      )
    } else {
      const shim = path.join(dir, 'eas-secret')
      // 路径每次重写：app 挪过位置（升级、拖进 /Applications）后旧路径就废了
      fs.writeFileSync(
        shim,
        `#!/bin/sh\n# Eas-Term 自动生成，勿手改\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${js}" "$@"\n`,
        { mode: 0o755 }
      )
      fs.chmodSync(shim, 0o755)
    }
    secretShimCache = dir
    return dir
  } catch (e) {
    console.error('[pty] 创建 eas-secret shim 失败(密钥只能靠新终端注入)', e)
    return null
  }
}

// 监听待打开队列：有新 URL 就通知渲染层在画板浏览器打开。
//
// **改成事件驱动了。** 原来是每 400ms `statSync` 一次，也就是每小时 9000 次系统调用、
// 每秒 2.5 次把 CPU 从深睡里叫起来 —— 而且应用完全空闲、窗口在后台时照跑。
// 这个队列一天可能就用几次（终端里 CLI 调 `open <url>` 才写），拿常驻轮询换它不划算：
// 空闲功耗看的不是 CPU 时间，是唤醒频次。
// fs.watch 在没人写文件时零唤醒；watch 起不来（某些文件系统不支持）才退回轮询。
function watchUrlQueue(): void {
  const file = urlQueueFile()
  try {
    fs.writeFileSync(file, '')
  } catch {
    return
  }
  let last = 0

  const drain = (): void => {
    try {
      const st = fs.statSync(file)
      if (st.size <= last) {
        if (st.size < last) last = 0 // 被清空/换了新文件 → 从头读
        return
      }
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(st.size - last)
      fs.readSync(fd, buf, 0, buf.length, last)
      fs.closeSync(fd)
      last = st.size
      for (const url of buf.toString('utf8').split('\n').map((s) => s.trim()).filter(Boolean)) {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.webContents.isDestroyed()) w.webContents.send('shell:openInCanvas', url)
        }
      }
    } catch {
      /* 文件还没建/被清空，忽略 */
    }
  }

  try {
    // 一次写入可能触发多个事件（rename + change），30ms 合并掉，免得同一批 URL 读两遍
    let t: ReturnType<typeof setTimeout> | null = null
    const w = fs.watch(file, () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        t = null
        drain()
      }, 30)
    })
    w.on('error', () => {
      // watch 中途失效（文件被删/替换）→ 退回轮询，别让这个功能整体失灵
      try {
        w.close()
      } catch {
        /* 已经关了 */
      }
      setInterval(drain, 400)
    })
  } catch {
    setInterval(drain, 400) // 文件系统不支持 watch
  }
}

// 判断哪些 shell 进程"忙"：一次性取系统所有进程的父 PID，
// 若某 shell 的 PID 出现在父 PID 集合里，说明它有子进程（前台命令或后台任务）在跑。
// 空闲的登录 shell 没有子进程，因此不会误报。跨平台：unix 用 ps，Windows 用 PowerShell。
function shellsWithChildren(shellPids: number[]): Promise<Set<number>> {
  return new Promise((resolve) => {
    if (shellPids.length === 0) {
      resolve(new Set())
      return
    }
    const collect = (stdout: string): void => {
      const parents = new Set<number>()
      for (const line of stdout.split('\n')) {
        const n = parseInt(line.trim(), 10)
        if (n > 0) parents.add(n)
      }
      resolve(new Set(shellPids.filter((pid) => parents.has(pid))))
    }
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process).ParentProcessId'],
        { timeout: 4000, windowsHide: true },
        (err, stdout) => (err ? resolve(new Set()) : collect(stdout))
      )
    } else {
      execFile('ps', ['-axo', 'ppid='], { timeout: 2500 }, (err, stdout) =>
        err ? resolve(new Set()) : collect(stdout)
      )
    }
  })
}

// 取某个 shell 进程的当前工作目录（供终端相对路径链接解析用）。
// 用户 cd 后 shell 进程的 cwd 随之变化，因此能反映"终端现在在哪"。
// linux 读 /proc；mac 用 lsof（绝对路径 /usr/sbin/lsof，打包应用 PATH 受限）；
// Windows 无简单等价手段，返回 null，由渲染层回退到终端启动目录。
function cwdOfPid(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      resolve(null)
      return
    }
    if (process.platform === 'linux') {
      try {
        resolve(fs.readlinkSync(`/proc/${pid}/cwd`))
      } catch {
        resolve(null)
      }
      return
    }
    execFile(
      '/usr/sbin/lsof',
      ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'],
      { timeout: 2000 },
      (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        for (const line of stdout.split('\n')) {
          // -Fn 输出里 cwd 的路径行以 'n' 开头，后接绝对路径
          if (line.startsWith('n') && line[1] === '/') {
            resolve(line.slice(1))
            return
          }
        }
        resolve(null)
      }
    )
  })
}

/** 是否有任意终端正在运行命令（供退出确认用） */
export async function anyPtyBusy(): Promise<boolean> {
  const pids: number[] = []
  for (const entry of ptys.values()) {
    if (typeof entry.pty.pid === 'number') pids.push(entry.pty.pid)
  }
  const busy = await shellsWithChildren(pids)
  return busy.size > 0
}

export function registerPtyHandlers(): void {
  watchUrlQueue() // 监听 CLI 经 open shim 投递的网址 → 通知渲染层在画板浏览器打开
  ipcMain.handle('pty:create', (e, opts: PtyCreateOptions) => {
    const id = String(nextId++)
    let cwd = opts.cwd || os.homedir()
    try {
      if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir()
    } catch {
      cwd = os.homedir()
    }
    // PowerShell 不认 Unix 的 -l 登录参数，仅在非 Windows 传 -l
    const shellArgs = process.platform === 'win32' ? [] : ['-l']
    const proc = pty.spawn(defaultShell(), shellArgs, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env: (() => {
        const env: Record<string, string> = {
          ...(process.env as Record<string, string>),
          TERM_PROGRAM: 'Eas-Term'
        }
        // open shim 目录塞到 PATH 最前 → CLI 的 `open <url>` 命中我们的劫持，落到画板浏览器
        const shimDir = ensureOpenShim()
        if (shimDir) {
          env.PATH = `${shimDir}:${env.PATH ?? ''}`
          env.BROWSER = path.join(shimDir, 'open') // 照顾按 BROWSER 约定的工具
        }
        // MCP 上下文：跑在这个终端里的 AI 据此知道「我是哪个终端」→ 反查所属 Frame，
        // 于是 open_html 之类的工具不用问就能开在正确的 Frame 里
        Object.assign(env, mcpEnv({ ptyId: id, project: cwd }))
        // 密钥柜：渲染层只给变量名，值在主进程解密后直接进 env，不回传渲染层。
        // 和上面那行的 EAS_TERM_TOKEN 是同一条路 —— 这样密钥就不会进入和 AI 的对话。
        const secrets = secretsEnv(opts.secretNames)
        Object.assign(env, secrets)
        // 记下这个终端带了哪些变量（**只记名字**）：secret_check 要靠它回答
        // 「你这个终端能不能直接用 $X」，否则 agent 只能去 echo —— 而那正是我们禁止的
        noteInjected(id, Object.keys(secrets))
        // 包装命令：进程 env 在 spawn 这一刻就定死了，之后存进柜子的密钥这个终端永远读不到。
        // eas-secret run --group X -- <命令> 让它能在**当前终端**用上后来才存的密钥：
        // 值由 shim 向主进程现取、直接进子进程 env，不经 stdout、不进 shell history
        // （命令行里只有组名）。见 ensureSecretShim 的注释。
        const secDir = ensureSecretShim()
        if (secDir) env.PATH = `${secDir}:${env.PATH ?? ''}`
        return env
      })()
    })
    const wc = e.sender
    // 输出合批背压:高吞吐(cat 大文件 / 刷屏 / 构建日志)时逐块 wc.send 会用海量小 IPC 消息
    // 灌满通道、拖垮渲染主线程(卡死甚至 OOM 崩溃→白屏)。这里按 pty 累积,~16ms 或积到 64KB
    // 再合并成一条发,大幅降 IPC 次数。渲染侧本就有 rAF 写入合并,两端配合更稳。
    let outBuf: string[] = []
    let outBytes = 0
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flushOut = (): void => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (!outBuf.length) return
      const data = outBuf.join('')
      outBuf = []
      outBytes = 0
      if (!wc.isDestroyed()) wc.send(`pty:data:${id}`, data)
    }
    proc.onData((data) => {
      outBuf.push(data)
      outBytes += data.length
      if (outBytes >= 64 * 1024)
        flushOut() // 大 burst 立即发,别攒出明显延迟
      else if (!flushTimer) flushTimer = setTimeout(flushOut, 16)
    })
    proc.onExit(({ exitCode }) => {
      flushOut() // 把残留输出先发完再发 exit,避免丢尾巴
      ptys.delete(id)
      if (!wc.isDestroyed()) wc.send(`pty:exit:${id}`, exitCode)
    })
    ptys.set(id, { pty: proc, wcId: wc.id })
    return { id }
  })

  ipcMain.on('pty:write', (_e, id: string, data: string) => {
    // pty 可能已 exit/被杀但 onExit 尚未从 map 删除，此时对已关闭 fd 写会同步抛 EPIPE/EIO。
    // 不包 try/catch 的话 → uncaughtException → 主进程退出 → 全窗口白屏（与 resize/kill 一致做法）。
    try {
      ptys.get(id)?.pty.write(data)
    } catch {
      // pty 正在退出，忽略这次写入
    }
  })

  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return
    try {
      ptys.get(id)?.pty.resize(cols, rows)
    } catch {
      // pty 可能正在退出，忽略
    }
  })

  ipcMain.on('pty:kill', (_e, id: string) => {
    const entry = ptys.get(id)
    if (entry) {
      ptys.delete(id)
      killTree(entry) // 连里面跑的 claude / 构建进程一起收掉，别留孤儿
    }
  })

  // 终端当前工作目录（供相对路径链接解析），取不到返回 null
  ipcMain.handle('pty:cwd', (_e, id: string): Promise<string | null> => {
    const pid = ptys.get(id)?.pty.pid
    if (typeof pid !== 'number') return Promise.resolve(null)
    return cwdOfPid(pid)
  })

  // 给定一组 pty id，返回其中正在运行命令的那些
  ipcMain.handle('pty:busyByIds', async (_e, ids: string[]) => {
    const pairs: { id: string; pid: number }[] = []
    for (const id of ids) {
      const pid = ptys.get(id)?.pty.pid
      if (typeof pid === 'number') pairs.push({ id, pid })
    }
    const busyPids = await shellsWithChildren(pairs.map((p) => p.pid))
    return pairs.filter((p) => busyPids.has(p.pid)).map((p) => p.id)
  })
}

/** 干掉一个终端及其**整棵进程树**。
 *
 *  判据是 controlling terminal（node-pty 的 ptsName，形如 /dev/ttys004），
 *  不是父子关系也不是进程组。踩过的两个坑：
 *   · 只 entry.pty.kill()：那只给 shell 发一个 SIGHUP，底下跑的 claude / 构建进程
 *     可能忽略它，app 退了照样活着，变成占 CPU 和端口的孤儿。
 *   · 只 kill(-pid) 打进程组：交互式 zsh 有 job control，`cmd &` 起的后台作业在
 *     **独立进程组**，进程组信号抓不到。实测 `sleep 900 &` 就这么活下来了。
 *   · 按会话（sid）也不行：macOS 的 ps 根本不认 sid 这个 keyword，pgrep 也没有 -s。
 *  而 `ps -t ttys004` 一次列全：前台、后台作业、nohup 的、甚至 `(cmd &)` 那种
 *  已经被 init 收养的孤儿——只要它的 controlling terminal 还是这个 pty，就跑不掉。
 */
function ttyPids(entry: Entry): number[] {
  if (process.platform === 'win32') return []
  const pts = (entry.pty as unknown as { ptsName?: string }).ptsName
  const name = pts?.replace(/^\/dev\//, '')
  if (!name) return []
  try {
    const out = execFileSync('ps', ['-t', name, '-o', 'pid='], { encoding: 'utf8' })
    return out
      .split('\n')
      .map((l) => Number(l.trim()))
      .filter((n) => n > 0)
  } catch {
    return [] // 该 tty 上没进程了，ps 会以非 0 退出
  }
}

function killTree(entry: Entry, signal: NodeJS.Signals = 'SIGTERM'): void {
  const pid = entry.pty.pid
  if (process.platform === 'win32') {
    // Windows 没有 controlling terminal 那套，但有 taskkill /T（按进程树杀）。
    // 只 pty.kill() 的话跟 macOS 一样的问题：shell 下面跑的 claude / 构建进程会变孤儿。
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], {
        stdio: 'ignore'
      })
    } catch {
      // taskkill 找不到进程会非 0 退出；再兜一次 pty 自己的 kill
      try {
        entry.pty.kill()
      } catch {
        /* 已退出 */
      }
    }
    return
  }
  // 先收后代（含脱离的），最后收 shell 自己——反过来的话 shell 一死，
  // ps -t 就查不到它了，剩下的进程会失联
  for (const p of ttyPids(entry)) {
    if (p === pid) continue
    try {
      process.kill(p, signal)
    } catch {
      /* 已退出 */
    }
  }
  try {
    process.kill(-pid, signal) // 进程组再兜一遍
  } catch {
    /* 组没了 */
  }
  try {
    process.kill(pid, signal)
  } catch {
    /* shell 已退出 */
  }
}

export function killPtysForWebContents(wcId: number): void {
  for (const [id, entry] of ptys) {
    if (entry.wcId === wcId) {
      ptys.delete(id)
      killTree(entry)
    }
  }
}

/** 退出时清场。分两拍：先 SIGTERM 给 CLI 存会话的机会，没走的再 SIGKILL。
 *  `hard` 由调用方控制节奏（before-quit 先软的，等一小会儿再硬的）。 */
export function killAllPtys(hard = false): void {
  for (const [, entry] of ptys) killTree(entry, hard ? 'SIGKILL' : 'SIGTERM')
  if (hard) ptys.clear()
}

/** 还有活着的终端吗（退出流程用来判断要不要再补一刀） */
export function anyPtyAlive(): boolean {
  for (const [, entry] of ptys) {
    try {
      process.kill(entry.pty.pid, 0) // 信号 0 = 只探活不真发信号
      return true
    } catch {
      /* 已经没了 */
    }
  }
  return false
}
