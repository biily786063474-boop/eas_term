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
import { BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'

import { PROBE_ENV } from '../probeEnv'
import { alog } from './log'
import { checkAuth } from './index'
import { installVerdict, lastLine, outLines } from './installOut'
import type { CliId } from './parse'

/** 安装最多跑多久。**给足** —— 慢网络上 curl 拉一个几十兆的包要好几分钟，
 *  超时砍掉一个正在正常下载的安装比等它更糟。 */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

/** 失败时回给界面多少行输出。够看清报错，又不至于糊满面板 */
const TAIL_LINES = 40

export interface InstallState {
  cli: CliId
  /** running=装着；verifying=装完在核实；done=真的能用了；failed=没成 */
  phase: 'running' | 'verifying' | 'done' | 'failed'
  /** 安装器自己最后说的那句话。**原样透传，不改写** */
  step?: string
  error?: string
  /** **失败时才有**：输出尾部。理由见文件头 ③ —— 这是终端那条路唯一不可替代的地方 */
  output?: string[]
}


let live: { cli: CliId; proc: ChildProcess; out: string[]; state: InstallState } | null = null

function push(): void {
  if (!live) return
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('cliAuth:install', live.state)
  }
}

function finish(phase: 'done' | 'failed', error?: string): void {
  if (!live) return
  alog(`安装结束：${live.cli} → ${phase}${error ? '（' + error + '）' : ''}`)
  live.state = {
    ...live.state,
    phase,
    error,
    // 成功时不回输出：那几十行没人要看，还会把面板撑开
    output: phase === 'failed' ? live.out.slice(-TAIL_LINES) : undefined
  }
  push()
  live = null
}

/**
 * 跑一条安装命令。
 *
 * **命令是渲染层传下来的**（来自 installPlan / CliInfo.installCmd），
 * 这一层不拼命令 —— 拼命令的地方只有 agentInstall.ts 一处，两处各拼一份必然分叉。
 */
export function startInstall(cli: CliId, cmd: string): { ok: boolean; error?: string } {
  if (live) return { ok: false, error: `正在安装 ${live.cli}，等它完成` }
  if (!cmd || !cmd.trim()) return { ok: false, error: '没有可用的安装命令' }
  alog(`开始安装：${cli} → ${cmd}`)
  let proc: ChildProcess
  try {
    // 走 shell 是安装命令本身的形态（`curl … | bash`、`npm install -g …`），
    // 不是我们额外加的一层。跑的是**和终端那条路一模一样的命令**。
    proc =
      process.platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { env: PROBE_ENV })
        : spawn('/bin/sh', ['-c', cmd], { env: PROBE_ENV })
  } catch (e) {
    alog('安装进程起不来：' + String(e))
    return { ok: false, error: String(e) }
  }
  live = { cli, proc, out: [], state: { cli, phase: 'running', step: '正在准备…' } }

  const onData = (d: Buffer): void => {
    if (!live || live.proc !== proc) return // 认身份，理由同 index.ts 的登录回调
    const chunk = d.toString()
    live.out.push(...outLines(chunk))
    // 只留够回显的量，别让一次 npm 安装把内存吃掉
    if (live.out.length > 400) live.out.splice(0, live.out.length - 400)
    const step = lastLine(chunk)
    if (step && step !== live.state.step) {
      live.state = { ...live.state, step }
      push()
    }
  }
  proc.stdout?.on('data', onData)
  // **stderr 也当进度看**：curl 的进度、npm 的 warning 全在 stderr，
  // 只收 stdout 的话进度条会一直停在「正在准备…」
  proc.stderr?.on('data', onData)

  const timer = setTimeout(() => {
    if (!live || live.proc !== proc) return
    alog(`安装超时：${cli}`)
    try {
      proc.kill()
    } catch {
      /* 已经没了 */
    }
    finish('failed', `超过 ${INSTALL_TIMEOUT_MS / 60000} 分钟还没装完`)
  }, INSTALL_TIMEOUT_MS)

  proc.on('error', (e) => {
    if (!live || live.proc !== proc) return
    clearTimeout(timer)
    finish('failed', String(e))
  })
  proc.on('close', (code) => {
    if (!live || live.proc !== proc) {
      alog(`旧安装进程退出：${cli} code=${String(code)}（已经不是当前流程，忽略）`)
      return
    }
    clearTimeout(timer)
    alog(`安装进程退出：${cli} code=${String(code)}`)
    // **退出码 0 不等于装上了**（装到不在 PATH 的地方、脚本吞了错、半路网断），
    // 所以还要查一次命令在不在。但**两条判据都要**：
    // 只看命令在不在会让「本来就装着、这次升级失败了」被报成成功
    //（2026-08-30 真机验证抓到的洞，判定逻辑抽成了 installVerdict 并有测试盯着）。
    live.state = { ...live.state, phase: 'verifying', step: '装好了，正在核实…' }
    push()
    void checkAuth(cli).then((st) => {
      if (!live || live.proc !== proc) return
      // 注意判据是 st.installed（命令在不在），**不是 st.status**：
      // 状态读不到是解析层跟上游脱节，不是安装失败，
      // 别拿我们自己的问题去告诉用户「装失败了」
      const v = installVerdict(code, st.installed)
      if (v.ok) finish('done')
      else finish('failed', v.error)
    })
  })
  push()
  return { ok: true }
}

export function cancelInstall(): void {
  if (!live) return
  alog(`用户取消安装：${live.cli}`)
  try {
    live.proc.kill()
  } catch {
    /* 已经没了 */
  }
  finish('failed', '你取消了安装')
}

export function registerCliInstallHandlers(): void {
  ipcMain.handle('cliAuth:startInstall', (_e, cli: CliId, cmd: string) => startInstall(cli, cmd))
  ipcMain.handle('cliAuth:cancelInstall', () => {
    cancelInstall()
    return { ok: true }
  })
}
