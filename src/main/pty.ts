import { app, ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import type { PtyCreateOptions } from '../shared/types'
import { mcpEnv } from './mcpBridge'

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

function ensureOpenShim(): string | null {
  if (process.platform !== 'darwin') return null
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

// 监听待打开队列：有新 URL 就通知渲染层在画板浏览器打开
function watchUrlQueue(): void {
  const file = urlQueueFile()
  try {
    fs.writeFileSync(file, '')
  } catch {
    return
  }
  let last = 0
  setInterval(() => {
    try {
      const st = fs.statSync(file)
      if (st.size <= last) {
        if (st.size < last) last = 0
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
  }, 400)
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
      try {
        entry.pty.kill()
      } catch {
        // 已退出
      }
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

export function killPtysForWebContents(wcId: number): void {
  for (const [id, entry] of ptys) {
    if (entry.wcId === wcId) {
      ptys.delete(id)
      try {
        entry.pty.kill()
      } catch {
        // 已退出
      }
    }
  }
}

export function killAllPtys(): void {
  for (const [, entry] of ptys) {
    try {
      entry.pty.kill()
    } catch {
      // 已退出
    }
  }
  ptys.clear()
}
