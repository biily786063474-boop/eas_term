// CLI 的登录状态查询与登录流程驱动。
//
// ── 为什么要有这一层 ────────────────────────────────────────────────
// 分发出去之后，「没装」和「没登录」是新用户最常撞的两堵墙，而 app 原来
// 对它们**一个字都没说**：未登录时 CLI 能正常启动（thread.started / turn.started
// 都发了），一发消息就撞 401、反复重试、进程死掉，界面只报
// 「CLI 进程退出（code N）」—— 用户看到的是「我一打字它就崩了」。
// 2026-08-30 用真实的空配置目录复现确认过。
//
// ── 一条不能碰的约束 ────────────────────────────────────────────────
// **登录预检绝不能塞进 `agentChat:start`。** 那个 handler 的同步性是承重的
// （见 preload/index.ts 里 2026-08-17 评审那段：它在 return 之前就同步走完
// deliverMessage → handleEvent → wc.send，探针实测同步推的 30 条只到 1 条）。
// 加一个 await 会把那条路径变成异步，事件时序全变。
// **所以预检在渲染层做** —— 调 start 之前先问一次这里。
//
// ── 不跳浏览器 ──────────────────────────────────────────────────────
// 用户明确要求「不要直接跳网页，给一个点我去登录的按钮，右键能复制链接」。
// 两边的做法不同（2026-08-29 实测）：
// · codex 有 `--device-auth`：**它自己就不开浏览器**，给链接 + 一次性码
// · claude 会自己弹浏览器 —— 用一个 no-op 的 `open` 垫在 PATH 最前面拦住它，
//   它同时还要求把授权码**粘回 stdin**，所以界面上要多一个输入框
import { BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { PROBE_ENV } from '../probeEnv'
import { alog, logPath, tail } from './log'
import {
  looksSucceeded,
  parseLoginOutput,
  parseStatus,
  type AuthStatus,
  type CliId,
  type LoginPrompt
} from './parse'

/** 查状态的超时。CLI 冷启在慢机器上要几秒，给足；但也不能无限 ——
 *  卡住的话界面会一直停在「正在检查」。 */
const STATUS_TIMEOUT_MS = 12_000

export interface CliAuthState {
  cli: CliId
  /** 命令在不在。**和「登没登录」是两件事** —— 没装时谈登录没有意义 */
  installed: boolean
  /** null = **读不到**（不是「没登录」）。两者界面上说的话完全不同 */
  status: AuthStatus | null
  /** 读不到时的原因，给日志和界面用 */
  error?: string
}

/** 登录流程的实时状态，推给界面 */
export interface LoginState {
  cli: CliId
  phase: 'starting' | 'waiting' | 'submitting' | 'done' | 'failed' | 'canceled'
  prompt?: LoginPrompt
  error?: string
}

const STATUS_ARGS: Record<CliId, string[]> = {
  claude: ['auth', 'status'],
  codex: ['login', 'status']
}

/** 登录命令。**默认走订阅登录**（用户 2026-08-29 定），
 *  Console / SSO 那两条收在「其它方式」里，不在首次链路上出现。 */
const LOGIN_ARGS: Record<CliId, string[]> = {
  claude: ['auth', 'login', '--claudeai'],
  // --device-auth：给链接 + 一次性码，**自己不开浏览器**，正是要的形态
  codex: ['login', '--device-auth']
}

/**
 * 一个只吞 URL 的假 `open`，垫在 PATH 最前面。
 *
 * **不复用 pty.ts 那个 shim** —— 那个把 URL 转进画板内嵌浏览器，
 * 而登录这条路要的是「什么都别做，URL 我自己从 stdout 拿」。
 * 两个目的不同，共用会让改一处影响另一处。
 */
function noopOpenDir(): string | null {
  if (process.platform === 'win32') return null
  try {
    const dir = path.join(os.tmpdir(), 'eas-login-shim')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'open')
    fs.writeFileSync(f, '#!/bin/sh\n# Eas-Term：登录流程里屏蔽自动开浏览器，URL 由界面呈现\nexit 0\n', { mode: 0o755 })
    fs.chmodSync(f, 0o755)
    return dir
  } catch (e) {
    alog('建 no-op open shim 失败（浏览器可能会自己弹）：' + String(e))
    return null
  }
}

function loginEnv(): NodeJS.ProcessEnv {
  const dir = noopOpenDir()
  const env = { ...PROBE_ENV }
  if (dir) env.PATH = `${dir}:${env.PATH ?? ''}`
  // BROWSER 是跨平台的老约定，顺手也设上 —— 不是所有 CLI 都走 `open`
  env.BROWSER = dir ? path.join(dir, 'open') : env.BROWSER
  return env
}

/** 查一个 CLI 的安装与登录状态。**读不到和没登录要分开** */
export function checkAuth(cli: CliId): Promise<CliAuthState> {
  return new Promise((resolve) => {
    const args = STATUS_ARGS[cli]
    alog(`查状态：${cli} ${args.join(' ')}`)
    let out = ''
    let done = false
    const finish = (s: CliAuthState): void => {
      if (done) return
      done = true
      alog(
        `状态结果：${cli} installed=${s.installed} ` +
          `loggedIn=${s.status ? s.status.loggedIn : '读不到'}` +
          (s.error ? ` error=${s.error}` : '')
      )
      resolve(s)
    }
    let proc: ChildProcess
    try {
      proc = spawn(cli, args, { env: PROBE_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      finish({ cli, installed: false, status: null, error: String(e) })
      return
    }
    const timer = setTimeout(() => {
      proc.kill()
      finish({ cli, installed: true, status: null, error: '查状态超时' })
    }, STATUS_TIMEOUT_MS)
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    // **stderr 也收**：有些版本把状态打到 stderr，只收 stdout 会读到空
    proc.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('error', (e) => {
      clearTimeout(timer)
      // ENOENT = 命令不在，这是「没装」，不是「没登录」
      const enoent = (e as NodeJS.ErrnoException).code === 'ENOENT'
      finish({ cli, installed: !enoent, status: null, error: enoent ? '命令不存在' : String(e) })
    })
    proc.on('close', () => {
      clearTimeout(timer)
      // **不看退出码** —— codex 未登录时也返回 0（见 parse.ts 顶部实测记录）
      finish({ cli, installed: true, status: parseStatus(cli, out) })
    })
  })
}

// ── 登录流程 ──────────────────────────────────────────────────────
let live: { cli: CliId; proc: ChildProcess; sofar: string; state: LoginState } | null = null

function pushLogin(): void {
  if (!live) return
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('cliAuth:login', live.state)
  }
}

function endLogin(phase: LoginState['phase'], error?: string): void {
  if (!live) return
  alog(`登录结束：${live.cli} → ${phase}${error ? '（' + error + '）' : ''}`)
  live.state = { ...live.state, phase, error }
  pushLogin()
  live = null
}

export function startLogin(cli: CliId): { ok: boolean; error?: string } {
  // **同一个 CLI 再点一次登录 = 重来一遍，不是错误。**
  // 界面上「重试」的实现是先 cancel 再 start，中间隔着两次 IPC 往返；
  // 靠消息顺序保证「cancel 一定先到」太脆 —— 一旦顺序颠倒，用户看到的是
  // 「已经有一个登录流程在跑」，而屏幕上明明什么都没有，只能重启软件。
  // 这里自己收掉旧的，让重试永远有效。
  if (live && live.cli === cli) {
    alog(`重新发起登录：${cli}（先收掉上一个）`)
    cancelLogin()
  }
  if (live) return { ok: false, error: `正在登录 ${live.cli}，先完成或取消那一个` }
  const args = LOGIN_ARGS[cli]
  alog(`开始登录：${cli} ${args.join(' ')}`)
  let proc: ChildProcess
  try {
    proc = spawn(cli, args, { env: loginEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    alog('登录进程起不来：' + String(e))
    return { ok: false, error: String(e) }
  }
  live = { cli, proc, sofar: '', state: { cli, phase: 'starting' } }
  const onData = (d: Buffer): void => {
    // **认身份**：这个回调闭包捕获的是它自己那个 proc，而 live 可能已经换人了
    //（重试：cancel 旧的 → start 新的，旧进程还会再吐几行）。
    // 不认的话，旧进程的输出会覆盖新流程的网址和设备码 —— 用户拿到的是过期的那份
    if (!live || live.proc !== proc) return
    live.sofar += d.toString()
    const prompt = parseLoginOutput(cli, live.sofar)
    // **只在真的多出东西时才推** —— CLI 会持续刷新那几行，
    // 每个 chunk 都推一次会让界面上的按钮反复重建
    const changed =
      prompt.url !== live.state.prompt?.url ||
      prompt.code !== live.state.prompt?.code ||
      prompt.needsCode !== live.state.prompt?.needsCode
    if (changed) {
      live.state = { cli, phase: 'waiting', prompt }
      alog(`登录提示更新：${cli} url=${prompt.url ? '有' : '无'} code=${prompt.code ? '有' : '无'} 需要粘码=${!!prompt.needsCode}`)
      pushLogin()
    }
    if (looksSucceeded(cli, live.sofar)) alog(`登录看起来成了：${cli}（仍以 status 复核为准）`)
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)
  // 下面两个回调都要先认身份，理由同 onData —— 而且这里错得更狠：
  // 旧进程被 kill 之后 close 事件是**异步**到的，那时新的登录早就起来了。
  // 不认身份的话，旧进程的死会把新流程标成「已结束」，界面立刻跑去查 status、
  // 查到没登录、报「登录流程结束了，但还是没登上」—— 而新进程其实正跑得好好的。
  proc.on('error', (e) => {
    if (!live || live.proc !== proc) return
    endLogin('failed', String(e))
  })
  proc.on('close', (code) => {
    if (!live || live.proc !== proc) {
      alog(`旧登录进程退出：${cli} code=${String(code)}（已经不是当前流程，忽略）`)
      return
    }
    // **不拿退出码当成功判据** —— 用户取消、超时都可能 0 退出。
    // 真正的判据是登录之后再查一次 status，那一步由渲染层做。
    alog(`登录进程退出：${cli} code=${String(code)}`)
    endLogin('done')
  })
  pushLogin()
  return { ok: true }
}

/** 把授权码写回 CLI 的 stdin（claude 那条路要）。 */
export function submitCode(code: string): { ok: boolean; error?: string } {
  if (!live) return { ok: false, error: '没有在跑的登录流程' }
  const t = code.trim()
  if (!t) return { ok: false, error: '授权码是空的' }
  alog(`回写授权码：${live.cli}（长度 ${t.length}）`) // **不记码本身**
  try {
    live.proc.stdin?.write(t + '\n')
    live.state = { ...live.state, phase: 'submitting' }
    pushLogin()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function cancelLogin(): void {
  if (!live) return
  alog(`用户取消登录：${live.cli}`)
  try {
    live.proc.kill()
  } catch {
    /* 已经没了 */
  }
  endLogin('canceled')
}

export function registerCliAuthHandlers(): void {
  ipcMain.handle('cliAuth:check', (_e, cli: CliId) => checkAuth(cli))
  ipcMain.handle('cliAuth:startLogin', (_e, cli: CliId) => startLogin(cli))
  ipcMain.handle('cliAuth:submitCode', (_e, code: string) => submitCode(code))
  ipcMain.handle('cliAuth:cancelLogin', () => {
    cancelLogin()
    return { ok: true }
  })
  /** 界面上「把日志给我看」的入口 —— 排障时不用让用户去翻 userData */
  ipcMain.handle('cliAuth:log', () => ({ path: logPath(), lines: tail(200) }))
}
