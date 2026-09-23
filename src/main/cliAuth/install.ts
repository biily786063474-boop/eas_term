// 在后台把 CLI 装上，把进度推给界面。**不开终端。**
//
// 用户 2026-08-29 的原话：「用户在 AI 对话模式下的安装行为也不要去显示终端，
// 要用安装进度条以及 cli 首次安装成功的某些选项以 GUI 的形式引导用户完成初次的设置链路」。
//
// ── 原来为什么送进终端，那两条理由现在怎么算 ────────────────────────
// agentInstall.ts 顶上列了三条「不代跑」的理由。逐条对一遍：
//
// ① 「静默装全局 CLI 是恶意软件行为特征」
//    —— **本来就不适用**：这是用户在界面上点确认触发的，不是背着他装。
//    AgentChatView 里那条 `prefillTerminal(cmd, { run: true })` 早就在替他跑了，
//    区别只在跑在哪儿。**命令原文仍然摆在确认框里**，他看得见自己同意了什么。
//
// ② 「装完还要登录，藏后台没有意义」
//    —— **这条已经不成立了**：登录现在有 GUI（CliLoginPanel），
//    装完直接接上登录面板，比让人回终端敲 `claude login` 顺。
//
// ③ 「公司网络 / 代理 / 权限失败时，报错摆在终端里用户能自己查」
//    —— **这条仍然成立，所以必须在这一层补回来**。失败时把输出尾部原样交给界面，
//    一句「安装失败」什么忙也帮不上。这是这个模块存在的硬约束，别为了界面干净删掉它。
//
// ── 进度怎么报 ──────────────────────────────────────────────────────
// **不编百分比。** curl|bash 和 npm 都不给可解析的进度，硬凑一个数字是在骗人
//（进度条卡在 87% 半分钟，比没有进度条更让人焦虑）。
// 报的是**我们真的知道的东西**：现在处于哪个阶段（下载安装 / 校验），
// 外加安装器自己最后打出来的那一行。那一行是真的，也正是用户想看的。
import { guardedHandle } from '../ipcGuard'
import { BrowserWindow } from 'electron'
import { registerOwnedCliProcess } from './ownedProcess.ts'
import { resolveInstallCommand } from './installCommand.ts'
import { installPlan } from '../agentInstall'
import { refreshCliCache } from '../agentChat/session'
import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'

import { PROBE_ENV } from '../probeEnv'
import { alog } from './log'
import { checkAuth, type CliAuthState } from './index'
import { createInstallOutput, installVerdict, shellForInstall } from './installOut'
import { createSlot } from './slot'
import type { CliId } from './parse'

/** 安装最多跑多久。**给足** —— 慢网络上 curl 拉一个几十兆的包要好几分钟，
 *  超时砍掉一个正在正常下载的安装比等它更糟。 */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

/** 失败时回给界面多少行输出。够看清报错，又不至于糊满面板 */
const TAIL_LINES = 40

import type { InstallState } from '../../shared/types'
export type { InstallState } from '../../shared/types'
import { redact } from './redact'
import { canCancelTask } from '../../shared/cliInstallPolicy'


// **同时只允许一个，且旧进程的回调必须哑掉** —— 靠 slot.guard 结构性保证，
// 不是靠每处记得写判断（那条 428ms 的真实事故见 slot.ts）
interface InstallLive {
  cli: CliId
  proc: ChildProcess
  out: string[]
  state: InstallState
  exited?: boolean
  stopReason?: string
  windowId?: number
  stopTimer?: ReturnType<typeof setTimeout>
  updateTimer?: ReturnType<typeof setTimeout>
}
const slot = createSlot<InstallLive>()
const snapshots = new Map<CliId, InstallState>()
export function installSnapshot(cli: CliId): InstallState | null { return snapshots.get(cli) ?? null }

function push(): void {
  const live = slot.any()
  if (!live) return
  snapshots.set(live.cli, { ...live.state })
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('cliAuth:install', live.state)
  }
}

function schedulePush(live: InstallLive): void {
  if (live.updateTimer) return
  live.updateTimer = setTimeout(() => {
    live.updateTimer = undefined
    if (slot.any() === live) push()
  }, 120)
}

function finish(phase: 'done' | 'failed' | 'canceled', error?: string): void {
  const live = slot.any()
  if (!live) return
  if (live.stopTimer) clearTimeout(live.stopTimer)
  if (live.updateTimer) clearTimeout(live.updateTimer)
  alog(`安装结束：${live.cli} → ${phase}${error ? '（' + error + '）' : ''}`)
  live.state = {
    ...live.state,
    phase,
    error: error ? redact(error) : undefined,
    updatedAt: Date.now(),
    output: live.out.slice(phase === 'failed' ? -TAIL_LINES : -80)
  }
  // listClis has its own availability cache. Invalidate before broadcasting
  // "done", so a renderer refresh triggered by this event sees the new binary.
  if (phase === 'done') refreshCliCache()
  push()
  slot.clear()
}

/**
 * 跑一条安装命令。
 *
 * **命令是渲染层传下来的**（来自 installPlan / CliInfo.installCmd），
 * 这一层不拼命令 —— 拼命令的地方只有 agentInstall.ts 一处，两处各拼一份必然分叉。
 */
let installGeneration = 0
/** owner：发起安装的窗口。传了就把进程登记进运行中心（可见、可停、一次确认）。 */
export function startInstall(cli: CliId, requested: string | undefined, owner?: { windowId: number }): { ok: boolean; error?: string } {
  const running = slot.any()
  if (running) return { ok: false, error: `正在安装 ${running.cli}，等它完成` }
  // S1（2026-09-14）：渲染层传来的只是"选哪条"，命令本身从主进程的方案表查；不在表里一律拒绝。
  const resolved = resolveInstallCommand(installPlan(), cli, requested)
  if (!resolved.ok) { alog(`拒绝安装请求：${cli} → ${resolved.error}`); return { ok: false, error: resolved.error } }
  const cmd = resolved.cmd
  alog(`开始安装：${cli} → ${cmd}`)
  let proc: ChildProcess
  try {
    // 走 shell 是安装命令本身的形态（`curl … | bash`、`npm install -g …`），
    // 不是我们额外加的一层。跑的是**和终端那条路一模一样的命令**。
    const shell = shellForInstall(cmd, process.platform)
    proc = spawn(shell.file, shell.args, { env: PROBE_ENV, detached: process.platform !== 'win32' })
  } catch (e) {
    alog('安装进程起不来：' + String(e))
    return { ok: false, error: String(e) }
  }
  slot.claim(proc, { cli, proc, windowId: owner?.windowId, out: [], state: { cli, phase: 'running', step: '正在准备…', startedAt: Date.now(), updatedAt: Date.now(), taskId: ++installGeneration } })
  // 运行中心登记（2026-09-13 缺口 3）：安装按方案不可任意中断，所以不排队；但要看得见、
  // 能经一次确认停掉。stop 走既有 cancelInstall（kill + 标失败），不另起杀法。
  if (owner) registerOwnedCliProcess({ id: `cli-install:${cli}:${installGeneration}`, name: `CLI 安装（${cli}）`, windowId: owner.windowId, proc, stop: () => { if (slot.any()?.proc === proc) cancelInstall() } })

  // **每个回调都包 guard(proc, …)** —— 见 slot.ts：漏写的唯一方式是不包，
  // 而不包就拿不到 live，写不出能跑的代码
  const stdoutText = new StringDecoder('utf8')
  const stderrText = new StringDecoder('utf8')
  const stdoutLines = createInstallOutput()
  const stderrLines = createInstallOutput()
  const append = (live: InstallLive, lines: string[]): void => {
    if (!lines.length) return
    live.out.push(...lines)
    if (live.out.length > 80) live.out.splice(0, live.out.length - 80)
    live.state = { ...live.state, step: lines.at(-1), output: [...live.out], updatedAt: Date.now() }
    schedulePush(live)
  }
  proc.stdout?.on('data', slot.guard(proc, (live, d: Buffer) => append(live, stdoutLines.write(stdoutText.write(d)))))
  // **stderr 也当进度看**：curl 的进度、npm 的 warning 全在 stderr，
  // 只收 stdout 的话进度条会一直停在「正在准备…」
  proc.stderr?.on('data', slot.guard(proc, (live, d: Buffer) => append(live, stderrLines.write(stderrText.write(d)))))

  const timer = setTimeout(
    slot.guard(proc, () => {
      alog(`安装超时：${cli}`)
      requestStop(`超过 ${INSTALL_TIMEOUT_MS / 60000} 分钟还没装完`)
    }),
    INSTALL_TIMEOUT_MS
  )

  proc.on(
    'error',
    slot.guard(proc, (live, e: Error) => {
      clearTimeout(timer)
      append(live, [...stdoutLines.write(stdoutText.end()), ...stdoutLines.flush(), ...stderrLines.write(stderrText.end()), ...stderrLines.flush()])
      finish('failed', String(e))
    })
  )
  proc.on(
    'close',
    slot.guard(proc, (live, code: number | null) => {
      clearTimeout(timer)
      append(live, [...stdoutLines.write(stdoutText.end()), ...stdoutLines.flush(), ...stderrLines.write(stderrText.end()), ...stderrLines.flush()])
      if (live.updateTimer) { clearTimeout(live.updateTimer); live.updateTimer = undefined }
      live.exited = true
      if (live.state.phase === 'stopping') { finish(live.stopReason ? 'failed' : 'canceled', live.stopReason || '安装已停止'); return }
      alog(`安装进程退出：${cli} code=${String(code)}`)
      // The installer is authoritative on failure. Do not let a second probe
      // (or an older, already-installed CLI) obscure its exit status/output.
      const exitVerdict = installVerdict(code, true)
      if (!exitVerdict.ok) { finish('failed', exitVerdict.error); return }
      // **退出码 0 不等于装上了**（装到不在 PATH 的地方、脚本吞了错、半路网断），
      // 所以还要查一次命令在不在。但**两条判据都要**：
      // 只看命令在不在会让「本来就装着、这次升级失败了」被报成成功
      //（2026-08-30 真机验证抓到的洞，判定逻辑抽成了 installVerdict 并有测试盯着）。
      live.state = { ...live.state, phase: 'verifying', step: '正在验证安装结果…' }
      push()
      // **这里要重新认一次身份**：checkAuth 是异步的，等它回来时槽位可能已经换人
      //（用户取消了这次安装又开了新的）。外层那个 guard 只保证进入 close 那一刻
      // 是当前主人，保证不了 await 之后还是。
      void checkAuth(cli).then(
        slot.guard(proc, (_l, st: CliAuthState) => {
          // 判据是 st.installed（命令在不在），**不是 st.status**：
          // 状态读不到是解析层跟上游脱节，不是安装失败，
          // 别拿我们自己的问题去告诉用户「装失败了」
          if (st.error) { finish('failed', '无法验证程序启动：' + st.error); return }
          const v = installVerdict(code, st.installed)
          if (v.ok) finish('done')
          else finish('failed', v.error)
        })
      ).catch(slot.guard(proc, () => finish('failed', '安装验证异常，请重试或查看诊断')))
    })
  )
  push()
  return { ok: true }
}

function requestStop(reason?: string): void {
  const live = slot.any()
  if (!live) return
  live.stopReason = reason ?? live.stopReason
  if (live.exited) { finish(reason ? 'failed' : 'canceled', reason || '安装已停止'); return }
  live.state = { ...live.state, phase: 'stopping', step: '正在等待安装进程退出…' }
  push()
  try {
    if (process.platform === 'win32' && live.proc.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(live.proc.pid), '/T', '/F'], { windowsHide: true })
      killer.on('close', (code) => { if(code !== 0 && slot.any() === live) { live.state = {...live.state,step:'停止请求未成功，可再次停止或在运行中心查看'}; push() } })
      killer.on('error', () => { if(slot.any() === live) { live.state = {...live.state,step:'停止请求失败，等待进程退出；请在运行中心查看'}; push() } })
    } else if (live.proc.pid) process.kill(-live.proc.pid, 'SIGTERM')
    else live.proc.kill()
  } catch { live.state = {...live.state,step:'未确认进程退出，请在运行中心查看'}; push() }
  if (!live.stopTimer && process.platform !== 'win32' && live.proc.pid) {
    live.stopTimer = setTimeout(() => {
      if (slot.any() !== live || live.exited) return
      try { process.kill(-live.proc.pid!, 'SIGKILL') }
      catch { live.state = {...live.state,step:'尚未确认退出，可再次停止或在运行中心查看'}; push() }
    }, 5000)
  }
  // Keep ownership until close; don't claim that kill() means completed.
}
export function cancelInstall(): void { requestStop() }

export function registerCliInstallHandlers(): void {
  guardedHandle('cliAuth:installSnapshot', (_e, cli: CliId) => installSnapshot(cli))
  guardedHandle('cliAuth:startInstall', (e, cli: CliId, requested?: unknown) => startInstall(cli, typeof requested === 'string' ? requested : undefined, { windowId: e.sender.id }))
  guardedHandle('cliAuth:cancelInstall', (e, cli: unknown, taskId: unknown) => {
    const live = slot.any()
    if (!live || !canCancelTask({cli: live.cli, taskId: live.state.taskId, windowId: live.windowId}, cli, taskId, e.sender.id)) return { ok: false }
    cancelInstall()
    return { ok: true }
  })
}
