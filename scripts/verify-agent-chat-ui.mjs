#!/usr/bin/env node
// Task 8（2026-08-15 对话界面 / 子项目 B）：agent 对话 UI 真机验证。
//
// 前七个任务的纯逻辑有 60 多条单测守着（归约器、工具栏映射），但**所有 UI 组件
// （空态、对话流、执行折叠、审批卡片、工具栏、hook 询问）一次都没有在真实浏览器里
// 跑过**。本仓库踩过这个坑：待办清单模块曾经渲染完美、`el.click()` 有反应，
// 但真实鼠标全部穿透——因为整层是 `pointer-events: none`。所以这里只用
// `Input.dispatchMouseEvent` 的真实坐标事件点击，绝不用 `el.click()`。
//
// ── 怎么造出 agent 节点：没有创建入口，直接注入 store（Ruling 6）──────────────────
// 目前没有任何界面路径能建 agent 节点（创建入口属于子项目 C）。本脚本照抄仓库一贯
// 做法（预置 projects.json 之类）：起一个隔离实例，通过 window.__store 直接把
// tab/leaf/canvas frame/node 塞进状态，再 setMaximizedNode 让它铺满视口——这样
// 所有点击坐标只需要 getBoundingClientRect()，不用手算画布世界坐标 × 缩放。
//
// ── 怎么喂事件：临时挂测试钩子，不花 CLI 额度 ────────────────────────────────────
// 生产构建里 window.__store 只在 DEV 挂、agentChat.start() 真的会 spawn CLI 花 token。
// 本脚本会在构建前对两个源文件做**临时、可逆**的补丁：
//   1. src/renderer/src/main.tsx —— __store 的 DEV 门槛临时短路成恒真。
//   2. src/preload/index.ts —— 加一个只在 EAS_AGENT_CHAT_TEST=1 时生效的分支，
//      把 agentChat.start()/onEvent() 换成进程内假实现（不真的 IPC 到主进程、
//      不 spawn 任何 CLI），并额外暴露 window.__agentChatTestPush(sessionId, event)
//      把造好的 ChatEvent 直接喂给已订阅的回调——链路是「真实 handleSend() → 假
//      start() 秒回 sessionId → 真实 onEvent 订阅 → 假 push() → 真实归约器 → 真实
//      渲染」，只有 IPC 传输这一环是假的，被测的组件代码一行没动。resolveApproval
//      也在测试模式下包了一层：记下调用参数后**仍然真调用**真实 IPC（不是假掉），
//      这样既能验证决定真的从渲染层发了出去，又不牺牲"保持真实 IPC"这条边界。
//      其余 IPC（listClis / hookStatus / hookUninstall / setParams / stop）**保持
//      真实**——listClis 是真探测（本机装了 claude 与 codex，无成本），hookStatus
//      是只读文件检查。
// 跑完（无论成功失败、甚至被 Ctrl-C/SIGTERM/未捕获异常中断）都会把这两个文件还原成
// 原样并重新 build，不会把测试专用代码留在仓库里——见下面「补丁安全网」一节。
//
// ── 补丁安全网（2026-08-17 独立评审 CHANGES_REQUESTED 后加固，P0-1/P0-2）───────────
// 评审实测复现过一条确定性泄漏：`patched` 标志设在 patchSources() *之后*才置真，
// 一旦 preload 的补丁锚点失效（比如有人改了 onEvent 附近的一行注释），main.tsx
// 已经落盘的补丁就会被 finally 的 `if (patched)` 短路掉，永久留在"生产环境暴露
// window.__store"的状态，且 git status 只会在这一种失败模式下露出线索。
// 修法：**去掉 patched/builtOnce 这两个条件标志，finally 无条件调用
// restoreSources(ORIGINALS) + 无条件重新 build**——两个文件原本就没改时，写回同样的
// 内容、重建同样的产物都是无害的 no-op，不需要用标志去"聪明地"跳过。
// 第二条复现：脚本没有注册任何信号 handler，Ctrl-C（SIGINT）或终端被关掉时 Node
// 直接终止、finally 完全不会跑，两个源文件 **连同已经构建进 out/ 的假 transport 产物**
// 一起留在补丁态（out/ 是 gitignored 的，git status 连痕迹都不会露）。修法：在模块
// 顶层注册 SIGINT/SIGTERM/uncaughtException/unhandledRejection，同步把 ORIGINALS
// 写回去再退出（同步 fs 写在信号处理里是安全的）——这条路径不重新 build（构建要
// spawn 子进程、没必要在紧急退出路径上再等它），只在退出信息里明确提示"out/ 可能
// 残留测试构建，请手动 npm run build"。
//
// ── 试过、行不通的更干净方案（P0-3）─────────────────────────────────────────────
// 评审建议先试 `electron-vite build --mode development`：如果这样就能让
// import.meta.env.DEV 为真，main.tsx 就完全不用碰（out/ 本来就 gitignored）。
// **实测不成立**：`npx electron-vite build --mode development`（以及额外显式设
// `NODE_ENV=development` 两种都试了）产出的 out/renderer 里通过 grep 找不到任何
// "__store" 字符串——`if (import.meta.env.DEV) {...}` 整段被当成永假分支死代码消除掉
// 了，跟不传 --mode 的默认生产构建结果一模一样。也就是说 electron-vite 的 build
// 命令不管 --mode/NODE_ENV 传什么，都会让 DEV 解析成 false（这台机器上翻过它的
// dist chunk 没找到显式的硬编码证据，但两次独立实测结果一致，足以下结论"这条路
// 走不通"，不用再深挖 electron-vite 内部实现）。评审给的第二条退路"整个放进
// git worktree 一次性副本"也没有采用——协调方明确裁定"P0-1/P0-2 修完风险已可控，
// 结构性重做超出一个验证脚本该占的份额"，所以最终方案是：继续碰 main.tsx 这一行，
// 但把还原做成不管哪条退出路径都生效的安全网。
//
// ── 这个脚本只能在开发机手跑，不适合进 CI（P2-5）───────────────────────────────
// 断言 1 的 CLI 选项数量依赖本机真的装了 claude/codex（listClis 是真探测，不是假的）。
// 换一台没装这两个 CLI 的机器，脚本会在断言 1 就 fail 并中止——失败得很响亮、不是
// 假绿，但意味着这不是一个能塞进无人值守流水线的门禁，只能在确认装好 CLI 的开发机
// 上手动跑。
//
// 用法：node scripts/verify-agent-chat-ui.mjs

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

if (typeof WebSocket === 'undefined') {
  console.error(`✗ 需要 Node 22+（当前 ${process.version}）——本脚本用原生 WebSocket 连 CDP`)
  process.exit(2)
}

const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..')

// 本终端跑在真实 Eas-Term 里，shell 环境带着它的 EAS_TERM_PORT/TOKEN/PTY_ID/PROJECT。
// 自己起的隔离子进程必须清掉这四个，否则会把审批请求之类的东西发给用户正在用的那个实例。
const ENV_SCRUB_KEYS = ['EAS_TERM_PORT', 'EAS_TERM_TOKEN', 'EAS_PTY_ID', 'EAS_PROJECT']
function envFor(extra = {}) {
  const env = { ...process.env }
  for (const k of ENV_SCRUB_KEYS) delete env[k]
  return { ...env, ...extra }
}

function log(...args) {
  console.log('[t8]', ...args)
}

// ════════════════════════════ 补丁安全网（P0-1/P0-2）════════════════════════════
//
// ORIGINALS：[file, 原始内容] 的数组，main() 一开始（还没做任何改动之前）就读进来、
// 赋给这个模块级变量。之后不管走哪条退出路径（正常 finally / SIGINT / SIGTERM /
// 未捕获异常），都从这里拿"真相"写回去——不依赖任何"是否已经改过"的旗标判断，
// 写回同样的内容是无害的 no-op，这样就不存在"标志没来得及置真、该还原的没还原"
// 这一整类 bug（评审在 P0-1 实测复现过一次）。
let ORIGINALS = null
// 已经 spawn 出来的隔离 Electron 实例——紧急退出时要尽力杀掉它，不留孤儿窗口。
// 只会在本脚本自己 spawn 的这一个 PID（的进程组）上调用 kill，不影响用户正在用的 Eas-Term。
let CHILD_PROC = null
let emergencyHandled = false

/** 自查时额外发现的一个坑（不在评审的 P0-1/P0-2 清单里，但同属"杀不干净留孤儿"这一类，
 *  顺手一起修）：`node_modules/.bin/electron` 不是真正的 Electron 二进制，是一层 Node
 *  包装脚本（cli.js）——它自己 spawn 真正的 Electron.app 作为子进程，`proc.pid` 拿到的
 *  只是这层包装脚本的 PID。包装脚本对 SIGTERM/SIGINT 有转发逻辑（收到就转发给真正的
 *  Electron.app），但**SIGKILL 没法被任何进程捕获转发**——直接杀包装脚本时，真正的
 *  Electron.app（连同它的 GPU/renderer/utility 子进程）会瞬间变成孤儿，杀不掉。
 *  实测复现：紧急信号 handler 直接对 CHILD_PROC 发 SIGKILL 后，`ps` 里能看到一整棵
 *  Electron 进程树还活着、重新挂到了 PID 1 下面。
 *  修法：spawn 隔离实例时带 `detached: true`，让包装脚本自己成为一个新进程组的组长
 *  （不带这个选项它会留在编排者自己的进程组里，那时候 `process.kill(-pid)` 会连编排者
 *  自己一起杀掉，非常危险）；包装脚本 spawn 真正 Electron.app 时没有单独开新组，所以
 *  真正的 Electron.app 和它的所有子进程都会继承这个新组。kill 的时候用负 PID
 *  （`process.kill(-pid, signal)`）一次性带走整棵树，不依赖包装脚本的 JS 转发逻辑，
 *  SIGKILL 也能正确送达每一个进程。 */
function killIsolatedInstance(childProc, signal) {
  if (!childProc || !childProc.pid) return
  try {
    process.kill(-childProc.pid, signal) // 负号：发给整个进程组，不只是包装脚本自己
  } catch {
    try {
      childProc.kill(signal) // 进程组 kill 失败（比如根本没进程组）时退回单 PID
    } catch {
      /* 已经不在了 */
    }
  }
}

function emergencyRestore(reason) {
  if (emergencyHandled) return
  emergencyHandled = true
  console.error('')
  console.error(`[t8] ⚠ 收到 ${reason}，脚本没能走完正常流程，执行紧急清理…`)
  if (ORIGINALS) {
    try {
      for (const [file, content] of ORIGINALS) fs.writeFileSync(file, content)
      console.error('[t8] ✓ 已同步还原两个临时补丁文件（main.tsx / preload/index.ts）')
    } catch (e) {
      console.error(`[t8] ✗ 还原源文件失败，请手动检查 git status：${e.message}`)
    }
  }
  // 紧急路径故意不重新 build（build 要 spawn 子进程、没必要在退出路径上再等它）——
  // 源码已经还原，但 out/ 目录（gitignored，git status 看不见）可能还残留着带假
  // transport 的测试构建产物，必须在这里把这句话喊出来，不能指望用户自己想到。
  console.error('[t8] ⚠ out/ 目录可能残留测试构建产物（含假 agentChat transport），请手动执行一次 npm run build 再继续。')
  if (CHILD_PROC && CHILD_PROC.pid) {
    // 用进程组 kill（见 killIsolatedInstance 注释）——直接 SIGKILL 包装脚本会让真正的
    // Electron.app 变孤儿，这里要连整棵树一起带走，紧急路径不需要走 SIGTERM 优雅退出那一步。
    killIsolatedInstance(CHILD_PROC, 'SIGKILL')
    console.error(`[t8] ✓ 已尝试杀掉隔离 Electron 实例整棵进程树（组长 PID ${CHILD_PROC.pid}）`)
  }
}

process.on('SIGINT', () => {
  emergencyRestore('SIGINT（Ctrl-C）')
  process.exit(130)
})
process.on('SIGTERM', () => {
  emergencyRestore('SIGTERM')
  process.exit(143)
})
process.on('uncaughtException', (e) => {
  console.error('[t8] ✗ 未捕获异常：', e?.stack || e)
  emergencyRestore('uncaughtException')
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error('[t8] ✗ 未处理的 Promise rejection：', e)
  emergencyRestore('unhandledRejection')
  process.exit(1)
})

async function freePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

function runBuild(label) {
  log(`▸ ${label}：npm run build（electron-vite build）…`)
  const t0 = Date.now()
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: PROJECT_ROOT,
    env: envFor(),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  if (r.status !== 0) {
    console.error(r.stdout?.slice(-4000))
    console.error(r.stderr?.slice(-4000))
    throw new Error(`${label} 失败（exit=${r.status}，耗时 ${secs}s）——见上面构建输出`)
  }
  log(`  ✓ 构建成功（${secs}s）`)
}

// ════════════════════════════ 第一部分：临时源码补丁（可逆） ════════════════════════════

const MAIN_TSX = path.join(PROJECT_ROOT, 'src/renderer/src/main.tsx')
const PRELOAD_TS = path.join(PROJECT_ROOT, 'src/preload/index.ts')

const MAIN_TSX_ANCHOR = `if (import.meta.env.DEV) {`
const MAIN_TSX_PATCHED = `if (true /* TEMP task-8 e2e，见 scripts/verify-agent-chat-ui.mjs，验完自动还原 */ || import.meta.env.DEV) {`

const PRELOAD_CONST_ANCHOR = `const api = {\n  platform: process.platform,`
const PRELOAD_CONST_PATCHED = `// TEMP(task-8 e2e，见 scripts/verify-agent-chat-ui.mjs)：只在显式传 EAS_AGENT_CHAT_TEST=1
// 时启用，正常开发/生产构建不受影响。只替换 agentChat.start/onEvent 对渲染层暴露的行为
// （避免真的 spawn CLI 花 token），resolveApproval 保留真实 IPC 调用、只是顺手记一份
// 调用参数（不牺牲"保持真实 IPC"这条边界），其余 agentChat IPC（listClis/hookStatus/...）
// 保持真实调用。验证脚本负责在跑完后把这处改动还原、重新构建，不是永久生产逻辑。
const AGENT_CHAT_TEST_MODE = process.env.EAS_AGENT_CHAT_TEST === '1'
const fakeAgentChatListeners = new Map<string, (e: ChatEvent) => void>()
const testResolveApprovalCalls: { sessionId: string; approvalId: string; decision: string }[] = []

const api = {\n  platform: process.platform,`

const PRELOAD_START_ANCHOR = `    start: async (params: AgentChatStartParams): Promise<AgentChatStartResult> => {
      const result: AgentChatStartResult = await ipcRenderer.invoke('agentChat:start', params)
      if (result.ok) startAgentChatBuffering(result.sessionId)
      return result
    },`
const PRELOAD_START_PATCHED = `    start: AGENT_CHAT_TEST_MODE
      ? async (_params: AgentChatStartParams): Promise<AgentChatStartResult> => {
          return { ok: true, sessionId: 'e2e-fake-session' }
        }
      : async (params: AgentChatStartParams): Promise<AgentChatStartResult> => {
          const result: AgentChatStartResult = await ipcRenderer.invoke('agentChat:start', params)
          if (result.ok) startAgentChatBuffering(result.sessionId)
          return result
        },`

const PRELOAD_ONEVENT_ANCHOR = `    onEvent: (sessionId: string, cb: (e: ChatEvent) => void): (() => void) => {
      const channel = \`agentChat:event:\${sessionId}\`
      // 先把 start() 之后、这次订阅之前攒下的事件回放掉，再切到实时监听——
      // 和 pty.onData 的做法逐字一致。
      const pending = agentChatPendingBuffers.get(sessionId)
      if (pending) {
        ipcRenderer.removeListener(channel, pending.listener)
        agentChatPendingBuffers.delete(sessionId)
        for (const ev of pending.events) cb(ev)
      }
      const listener = (_e: IpcRendererEvent, ev: ChatEvent): void => cb(ev)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }`
const PRELOAD_ONEVENT_PATCHED = `    onEvent: AGENT_CHAT_TEST_MODE
      ? (sessionId: string, cb: (e: ChatEvent) => void): (() => void) => {
          fakeAgentChatListeners.set(sessionId, cb)
          return () => {
            fakeAgentChatListeners.delete(sessionId)
          }
        }
      : (sessionId: string, cb: (e: ChatEvent) => void): (() => void) => {
          const channel = \`agentChat:event:\${sessionId}\`
          // 先把 start() 之后、这次订阅之前攒下的事件回放掉，再切到实时监听——
          // 和 pty.onData 的做法逐字一致。
          const pending = agentChatPendingBuffers.get(sessionId)
          if (pending) {
            ipcRenderer.removeListener(channel, pending.listener)
            agentChatPendingBuffers.delete(sessionId)
            for (const ev of pending.events) cb(ev)
          }
          const listener = (_e: IpcRendererEvent, ev: ChatEvent): void => cb(ev)
          ipcRenderer.on(channel, listener)
          return () => ipcRenderer.removeListener(channel, listener)
        }`

// P1-2（评审实测假绿）：断言 7 原来只看 .ac-approval 从 DOM 消失，而那个隐藏完全由
// ApprovalCard 的本地 state 决定——删掉真正的 onDecide(decision) 调用，断言照样绿，
// 也分不出点的是「允许」还是「拒绝」。这里让 resolveApproval 在测试模式下记一份调用
// 参数快照，但仍然真调用 ipcRenderer.invoke（不是假掉整条链路），验证脚本据此确认
// 「决定真的从渲染层发出去了、且是正确的那个 decision」。
const PRELOAD_RESOLVEAPPROVAL_ANCHOR = `    resolveApproval: (
      sessionId: string,
      approvalId: string,
      decision: 'allow' | 'deny'
    ): Promise<{ ok: boolean }> => ipcRenderer.invoke('agentChat:resolveApproval', sessionId, approvalId, decision),`
const PRELOAD_RESOLVEAPPROVAL_PATCHED = `    resolveApproval: AGENT_CHAT_TEST_MODE
      ? (sessionId: string, approvalId: string, decision: 'allow' | 'deny'): Promise<{ ok: boolean }> => {
          testResolveApprovalCalls.push({ sessionId, approvalId, decision })
          return ipcRenderer.invoke('agentChat:resolveApproval', sessionId, approvalId, decision)
        }
      : (
          sessionId: string,
          approvalId: string,
          decision: 'allow' | 'deny'
        ): Promise<{ ok: boolean }> => ipcRenderer.invoke('agentChat:resolveApproval', sessionId, approvalId, decision),`

const PRELOAD_EXPOSE_ANCHOR = `contextBridge.exposeInMainWorld('api', api)`
const PRELOAD_EXPOSE_PATCHED = `contextBridge.exposeInMainWorld('api', api)

// TEMP(task-8 e2e)：测试模式下额外暴露两个自省入口——
//   __agentChatTestPush(sessionId, event)：把假 ChatEvent 直接推给已注册监听器；
//   __agentChatTestGetResolveApprovalCalls()：读出 resolveApproval 被调用过的参数快照
//     （用函数而不是直接暴露数组本身——跨 contextBridge 的对象引用是否总能反映后续
//     push 的新元素没有文档承诺的保证，函数调用每次都会拿到当下最新的真实数据）。
// 见上面 AGENT_CHAT_TEST_MODE 的说明，验完自动还原。
if (AGENT_CHAT_TEST_MODE) {
  contextBridge.exposeInMainWorld('__agentChatTestPush', (sessionId: string, e: ChatEvent) => {
    fakeAgentChatListeners.get(sessionId)?.(e)
  })
  contextBridge.exposeInMainWorld('__agentChatTestGetResolveApprovalCalls', () =>
    testResolveApprovalCalls.map((c) => ({ ...c }))
  )
}`

function applyPatch(file, replacements, label) {
  let src = fs.readFileSync(file, 'utf8')
  for (const [anchor, patched] of replacements) {
    if (!src.includes(anchor)) {
      throw new Error(`补丁锚点在 ${file} 里没找到（源码可能已变化，需要更新脚本）：\n${anchor.slice(0, 120)}...`)
    }
    if (src.includes(patched)) continue // 已经是补丁后的内容，幂等跳过
    src = src.replace(anchor, patched)
  }
  fs.writeFileSync(file, src)
  log(`  ✓ 已临时补丁 ${label}`)
}

function patchSources() {
  applyPatch(MAIN_TSX, [[MAIN_TSX_ANCHOR, MAIN_TSX_PATCHED]], 'main.tsx（__store 恒暴露）')
  applyPatch(
    PRELOAD_TS,
    [
      [PRELOAD_CONST_ANCHOR, PRELOAD_CONST_PATCHED],
      [PRELOAD_START_ANCHOR, PRELOAD_START_PATCHED],
      [PRELOAD_ONEVENT_ANCHOR, PRELOAD_ONEVENT_PATCHED],
      [PRELOAD_RESOLVEAPPROVAL_ANCHOR, PRELOAD_RESOLVEAPPROVAL_PATCHED],
      [PRELOAD_EXPOSE_ANCHOR, PRELOAD_EXPOSE_PATCHED]
    ],
    'preload/index.ts（测试模式 start/onEvent + resolveApproval 记录 + __agentChatTestPush/GetResolveApprovalCalls）'
  )
}

function restoreSources(originals) {
  for (const [file, content] of originals) {
    fs.writeFileSync(file, content)
  }
  log('  ✓ 两个文件已还原成原样')
}

// ════════════════════════════ 第二部分：CDP 小工具 ════════════════════════════

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 1
    this.pending = new Map()
    this.consoleErrors = []
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m)
        this.pending.delete(m.id)
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(
          'EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? '').slice(0, 300)
        )
      }
    })
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = this.id++
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** 求值一段表达式，returnByValue，异常直接抛出（带出 CDP 的异常描述）。 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails
      throw new Error('eval 失败: ' + (d.exception?.description ?? d.text ?? JSON.stringify(d)))
    }
    return r.result?.result?.value
  }

  /** 真实坐标点击：mouseMoved → mousePressed → mouseReleased，不是 el.click()。 */
  async clickXY(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    })
    await sleep(40)
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    })
    await sleep(40)
  }

  /** 用一段「返回元素」的 JS 表达式定位目标，滚入视口、取真实屏幕坐标，再真实点击它的中心点。
   *  返回点击到的坐标，供调用方需要时复用（比如 elementFromPoint 断言）。 */
  async clickElement(findExpr, desc) {
    const rectJson = await this.eval(`(function(){
      const el = (${findExpr})
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = el.getBoundingClientRect()
      return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height })
    })()`)
    if (!rectJson) throw new Error(`clickElement: 找不到元素 —— ${desc}`)
    const { x, y, w, h } = JSON.parse(rectJson)
    if (w <= 0 || h <= 0) throw new Error(`clickElement: 元素尺寸为 0（不可能真实点击到）—— ${desc}`)
    await this.clickXY(x, y)
    return { x, y }
  }
}

async function waitFor(fn, { timeout = 8000, interval = 200, desc = '' } = {}) {
  const deadline = Date.now() + timeout
  let lastErr
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      lastErr = e
    }
    if (Date.now() > deadline) {
      throw new Error(`等待超时（${timeout}ms）：${desc}${lastErr ? ' | 最后一次错误: ' + lastErr.message : ''}`)
    }
    await sleep(interval)
  }
}

// ════════════════════════════ 第三部分：断言记录 ════════════════════════════

const ASSERTION_NAMES = {
  1: '画布上建出 agent 节点，空态可见（logo + 输入框 + CLI 选择器）',
  2: '真实坐标点击输入框能聚焦、能输入',
  3: '发送后切到对话态',
  4: '模型文字显示、执行区默认三行、点击展开显示全部',
  5: '折叠状态下失败项仍然可见',
  6: 'approval.request 到达时卡片以高层级出现',
  7: '点「允许」后卡片消失',
  8: "{k:'error',fatal:false} 的 notice 在界面上可见",
  9: '审批卡片出现时 elementFromPoint 命中的是卡片本身',
  10: '失败项与成功项的 computed style 有可辨识差异（非仅 class 名不同）',
  11: '用户自己发的消息出现在界面上，且顺序正确'
}
const results = {}
for (const k of Object.keys(ASSERTION_NAMES)) results[k] = { status: 'not-run', detail: '' }

function pass(id, detail) {
  results[id] = { status: 'PASS', detail }
  log(`  ✓ [断言${id}] ${ASSERTION_NAMES[id]} —— ${detail}`)
}
function fail(id, detail) {
  results[id] = { status: 'FAIL', detail }
  log(`  ✗ [断言${id}] ${ASSERTION_NAMES[id]} —— ${detail}`)
}
function skip(id, detail) {
  results[id] = { status: 'SKIP', detail }
  log(`  · [断言${id}] ${ASSERTION_NAMES[id]} —— 跳过（${detail}）`)
}

// ════════════════════════════ 第四部分：主流程 ════════════════════════════

async function main() {
  log('=== Task 8：agent 对话 UI 真机验证 ===')
  log('项目根：', PROJECT_ROOT)

  // 先读原始内容、立刻挂到模块级 ORIGINALS——从这一刻起，不管接下来在哪一步失败、
  // 还是收到 Ctrl-C/SIGTERM，都有"真相"可以还原（P0-1/P0-2 的安全网见文件顶部注释）。
  ORIGINALS = [MAIN_TSX, PRELOAD_TS].map((f) => [f, fs.readFileSync(f, 'utf8')])

  let proc = null
  let ws = null
  let cdp = null
  let userDataDir = null
  let projectDir = null

  try {
    patchSources()
    runBuild('构建测试版（含临时补丁）')

    userDataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-t8-userdata-')))
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-t8-project-')))
    // 跟 fsGuard 的既有先例一致（scripts/verify-agent-chat.mjs 用过同样手法）：
    // 直接在隔离 userData 里预置 projects.json，把临时项目目录注册成"已知项目根"，
    // 这样 hookStatus() 走的是真实 guardPath 通过之后的文件检查分支，而不是"未注册目录"
    // 的兜底分支——更贴近真实使用场景。
    fs.writeFileSync(
      path.join(userDataDir, 'projects.json'),
      JSON.stringify(
        [{ id: 't8-verify-project', name: 'agent-chat-ui-verify', path: projectDir, addedAt: Date.now() }],
        null,
        2
      )
    )

    const port = await freePort()
    const electronBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'electron')
    log(`▸ 启动隔离 Electron 实例（只会杀这一个自己起的 PID）`)
    log(`  userDataDir = ${userDataDir}`)
    log(`  projectDir  = ${projectDir}`)
    log(`  CDP port    = ${port}`)
    proc = spawn(
      electronBin,
      [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, '--no-sandbox'],
      {
        cwd: PROJECT_ROOT,
        env: envFor({ EAS_AGENT_CHAT_TEST: '1' }),
        stdio: ['ignore', 'pipe', 'pipe'],
        // detached:true 让 node_modules/.bin/electron 这层包装脚本自成一个新进程组
        // （见 killIsolatedInstance 注释）——不加这个选项它会留在编排者自己的进程组里，
        // 之后 process.kill(-pid) 会连编排者自己一起杀掉。
        detached: true
      }
    )
    CHILD_PROC = proc // 让紧急信号 handler 也够得到，能在异常退出时尽力杀掉它
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    let exitedEarly = null
    proc.on('exit', (code, signal) => {
      exitedEarly = { code, signal }
    })

    // ── 等 CDP target（排除灵动岛：红线给的判据）──────────────────────────────
    let target = null
    for (let i = 0; i < 40; i++) {
      if (exitedEarly) break
      await sleep(500)
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = list.find(
          (t) => t.type === 'page' && t.url.includes('out/renderer') && !t.url.includes('island')
        )
        if (target) break
      } catch {
        /* 还没起来 */
      }
    }
    if (!target) {
      throw new Error(
        `没等到渲染页面的 CDP target${exitedEarly ? `（进程已提前退出 code=${exitedEarly.code} signal=${exitedEarly.signal}）` : ''}。stderr 尾部:\n${stderr.slice(-1500)}`
      )
    }
    log(`  ✓ 找到 CDP target：${decodeURIComponent(target.url).slice(0, 90)}`)

    ws = new WebSocket(target.webSocketDebuggerUrl)
    cdp = new Cdp(ws)
    await new Promise((r) => ws.addEventListener('open', r))
    await cdp.send('Runtime.enable')
    await cdp.send('Input.setIgnoreInputEvents', { ignore: false })

    // P1-1/P2-2（评审实测假绿）：断言 11/1/4 原来只判 DOM 是否存在、textContent 是否
    // 匹配——这些都不受 display:none/visibility:hidden/opacity:0/尺寸为 0 影响。评审
    // 实测过：给 .ac-turn-user 加 display:none !important 后断言 11 照常绿，日志还写
    // "用户消息出现在第 1 个轮次"，而屏幕上那句话根本不存在。断言 8 早就做对了（尺寸 +
    // display + visibility + opacity 四件套），这里注入一个全局小函数复用同一套判据，
    // 不用在每个断言里重复写一遍。
    await cdp.eval(`(function(){
      window.__t8Visible = function(el){
        if (!el) return false
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0
      }
      return true
    })()`)

    // 给首帧渲染 + loadProjects()/loadCanvas() 初始异步加载留时间，再动手注入，
    // 避免跟它们的 setState 时序赛跑（loadCanvas 对一个全新 userData 是空场景，
    // 不会覆盖我们稍后的注入，但先等它跑完更干净）。
    await sleep(2500)

    // ── 首启引导弹窗防御：出现也绝不点「安装」，只点「以后再说」──────────────────
    const onboardingSeen = await cdp.eval(`!!document.querySelector('.onb-mask')`)
    if (onboardingSeen) {
      log('  · 检测到首启引导弹窗，点「以后再说」关掉（绝不点安装）')
      await cdp.clickElement(
        `Array.from(document.querySelectorAll('.onb-actions .onb-ghost')).find(b => b.textContent.includes('以后再说'))`,
        '首启引导「以后再说」按钮'
      )
      await sleep(300)
    }

    // ── 断言 1：注入 agent 节点，空态可见 ─────────────────────────────────────
    const hasStore = await cdp.eval(`typeof window.__store !== 'undefined'`)
    if (!hasStore) throw new Error('window.__store 不存在——main.tsx 的临时补丁没生效？')
    const hasTestPush = await cdp.eval(`typeof window.__agentChatTestPush !== 'undefined'`)
    if (!hasTestPush) throw new Error('window.__agentChatTestPush 不存在——preload 的临时补丁没生效？')

    const IDS = { tabId: 't8-tab', leafId: 't8-leaf', frameId: 't8-frame', nodeId: 't8-node' }
    const injectExpr = `(function(){
      const s = window.__store.getState()
      window.__store.setState({
        viewMode: 'canvas',
        tabs: [...s.tabs, {
          id: ${JSON.stringify(IDS.tabId)},
          title: 'agent-e2e',
          projectId: null,
          cwd: ${JSON.stringify(projectDir)},
          root: { type: 'leaf', id: ${JSON.stringify(IDS.leafId)}, pane: { kind: 'agent', cwd: ${JSON.stringify(projectDir)} } },
          activeLeafId: ${JSON.stringify(IDS.leafId)}
        }],
        activeTabId: ${JSON.stringify(IDS.tabId)},
        canvas: {
          ...s.canvas,
          frames: [...s.canvas.frames, {
            id: ${JSON.stringify(IDS.frameId)},
            projectId: null,
            name: 'agent-e2e-frame',
            x: 0, y: 0, w: 900, h: 700,
            collapsed: false,
            nodes: [{ id: ${JSON.stringify(IDS.nodeId)}, leafId: ${JSON.stringify(IDS.leafId)}, x: 20, y: 50, w: 820, h: 600 }]
          }]
        }
      })
      window.__store.getState().setMaximizedNode({ frameId: ${JSON.stringify(IDS.frameId)}, nodeId: ${JSON.stringify(IDS.nodeId)} })
      return true
    })()`
    const injected = await cdp.eval(injectExpr)
    if (!injected) throw new Error('store 注入没有返回 true')
    await sleep(400)

    const emptyState = await waitFor(
      async () => {
        const j = await cdp.eval(`(function(){
          const root = document.querySelector('.agent-chat-view .ac-empty')
          if (!root) return null
          const logo = root.querySelector('.ac-logo svg')
          const input = root.querySelector('textarea.ac-input')
          return JSON.stringify({
            hasLogo: !!logo,
            logoVisible: window.__t8Visible(logo),
            hasInput: !!input,
            inputVisible: window.__t8Visible(input),
            cliCount: root.querySelectorAll('.ac-clis .ac-cli-chip').length,
            hint: root.querySelector('.ac-clis-hint')?.textContent || null
          })
        })()`)
        if (!j) return null
        const parsed = JSON.parse(j)
        return parsed.cliCount > 0 || parsed.hint ? parsed : null
      },
      { timeout: 8000, desc: '空态渲染（logo/输入框/CLI 选择器）' }
    )
    if (emptyState.hasLogo && emptyState.logoVisible && emptyState.hasInput && emptyState.inputVisible && emptyState.cliCount > 0) {
      pass(
        1,
        `logo=存在且可见 input=存在且可见 CLI 选项=${emptyState.cliCount} 个（可见性判据：尺寸+display+visibility+opacity 四件套，非仅 DOM 存在性）`
      )
    } else {
      fail(1, `详情=${JSON.stringify(emptyState)}`)
      throw new Error('空态没有完整渲染，后续步骤依赖它，中止')
    }

    // 显式点第一个 CLI 芯片（真实坐标）——让 selected 确定下来，不依赖默认值猜测
    await cdp.clickElement(`document.querySelector('.ac-clis .ac-cli-chip')`, '第一个 CLI 选择芯片')
    const selectedName = await cdp.eval(`document.querySelector('.ac-cli-chip.selected')?.textContent || null`)
    log(`  · 已选中 CLI：${selectedName}`)

    // ── 断言 2：真实坐标点击输入框，聚焦 + 输入 ─────────────────────────────────
    const TEST_MESSAGE = '帮我看一下这个目录里都有什么（task-8 e2e 验证脚本发送）'
    await cdp.clickElement(`document.querySelector('textarea.ac-input')`, '空态输入框')
    const focusedAfterClick = await cdp.eval(
      `document.activeElement && document.activeElement.classList.contains('ac-input')`
    )
    await cdp.send('Input.insertText', { text: TEST_MESSAGE })
    await sleep(150)
    const typedValue = await cdp.eval(`document.querySelector('textarea.ac-input')?.value || ''`)
    if (focusedAfterClick && typedValue === TEST_MESSAGE) {
      pass(2, `真实坐标点击后 document.activeElement 命中输入框；Input.insertText 后 value 与预期完全一致`)
    } else {
      fail(2, `focused=${focusedAfterClick} typedValue=${JSON.stringify(typedValue)}`)
      throw new Error('输入框聚焦/输入没有成功，后续步骤依赖它，中止')
    }

    // ── 断言 3：点发送，切到对话态（中间可能先经过 hook 安装询问卡片）──────────────
    await cdp.clickElement(`document.querySelector('button.ac-send')`, '「发送」按钮')

    const afterSend = await waitFor(
      async () => {
        const j = await cdp.eval(`JSON.stringify({
          hookAsk: !!document.querySelector('.ac-hook-ask'),
          conversation: !!document.querySelector('.agent-chat-view .ac-messages')
        })`)
        const p = JSON.parse(j)
        return p.hookAsk || p.conversation ? p : null
      },
      { timeout: 8000, desc: '发送后应出现 hook 询问卡片或直接进入对话态' }
    )
    if (afterSend.hookAsk) {
      log('  · 出现审批 hook 安装询问卡片，点「这次不装，直接开始」（真实坐标）')
      await cdp.clickElement(
        `document.querySelector('.ac-hook-ask .ac-approval-btn.deny')`,
        'hook 询问卡片「这次不装」按钮'
      )
    }
    const conversationUp = await waitFor(
      async () => await cdp.eval(`!!document.querySelector('.agent-chat-view .ac-messages')`),
      { timeout: 8000, desc: '切换到对话态（.ac-messages 出现）' }
    )
    if (conversationUp) {
      pass(
        3,
        `真实 handleSend() → hookStatus() 真实 IPC${afterSend.hookAsk ? '（触发了 hook 询问卡片，已按真实交互点掉）' : ''} → 假 start() 秒回 sessionId → .ac-messages 出现`
      )
    } else {
      fail(3, '未观察到 .ac-messages 出现')
      throw new Error('没有进入对话态，后续步骤依赖它，中止')
    }

    // ── 用测试钩子喂事件：两轮 assistant turn ──────────────────────────────────
    const SESSION_ID = 'e2e-fake-session'
    async function push(event) {
      const ok = await cdp.eval(
        `(function(){ window.__agentChatTestPush(${JSON.stringify(SESSION_ID)}, ${JSON.stringify(event)}); return true })()`
      )
      if (!ok) throw new Error('push 事件失败：' + JSON.stringify(event))
    }

    // Turn A：5 个工具调用，其中第 1 个（不在"最近 3 条"窗口内）失败——专门验证
    // 「折叠状态下失败项仍可见」不是因为它恰好落在最近三条里。
    await push({ k: 'text.done', text: '第一步：批量处理 5 个文件，其中一个失败了。' })
    await push({ k: 'exec.start', execId: 'e1', label: '删除 /tmp/e2e-locked-file', detail: '{"path":"/tmp/e2e-locked-file"}' })
    await push({ k: 'exec.done', execId: 'e1', ok: false, output: 'Permission denied' })
    await push({ k: 'exec.start', execId: 'e2', label: '创建 a.txt', detail: '{"path":"a.txt"}' })
    await push({ k: 'exec.done', execId: 'e2', ok: true, output: 'created' })
    await push({ k: 'exec.start', execId: 'e3', label: '创建 b.txt', detail: '{"path":"b.txt"}' })
    await push({ k: 'exec.done', execId: 'e3', ok: true, output: 'created' })
    await push({ k: 'exec.start', execId: 'e4', label: '创建 c.txt', detail: '{"path":"c.txt"}' })
    await push({ k: 'exec.done', execId: 'e4', ok: true, output: 'created' })
    await push({ k: 'exec.start', execId: 'e5', label: '创建 d.txt', detail: '{"path":"d.txt"}' })
    await push({ k: 'exec.done', execId: 'e5', ok: true, output: 'created' })
    await sleep(200)

    const TURN_A_FIND = `Array.from(document.querySelectorAll('.ac-turn-assistant')).find(t => (t.querySelector('.ac-turn-text')?.textContent || '').includes('第一步'))`

    // ── 断言 5：折叠状态下失败项仍然可见 ─────────────────────────────────────
    // P2-3（评审：契约比 < 5 更精确）：visibleExecs 的契约是「最近三条 ∪ 全部失败项」，
    // Turn A 5 个 exec、失败项在 index 0（不在"最近三条"=index 2/3/4 内），正确答案
    // 精确等于 4（3 条最近 + 1 条失败，不重叠）。原来写 < 5 的话，窗口退化成"最近两条"
    // （可见 e1+e4+e5=3 行）这种更严重的 bug 也会被判定通过，跟断言 4 用 Turn B 精确
    // 锁死"3"这个数字的严格程度不一致，这里补齐。
    const turnAState = await cdp.eval(`(function(){
      const t = ${TURN_A_FIND}
      if (!t) return null
      const rows = Array.from(t.querySelectorAll('.ac-exec-row'))
      const failedEl = rows.find(r => r.classList.contains('ac-exec-failed'))
      return JSON.stringify({
        visibleCount: rows.length,
        totalLabel: t.querySelector('.ac-execs-toggle')?.textContent || null,
        hasFailedVisible: !!failedEl,
        failedVisibleGenuinely: window.__t8Visible(failedEl),
        failedIsE1: !!failedEl && (failedEl.querySelector('.ac-exec-label')?.textContent || '').includes('e2e-locked-file')
      })
    })()`)
    if (!turnAState) throw new Error('找不到 Turn A（text 含"第一步"的 assistant 轮次）')
    const ta = JSON.parse(turnAState)
    if (ta.hasFailedVisible && ta.failedVisibleGenuinely && ta.failedIsE1 && ta.visibleCount === 4) {
      pass(
        5,
        `折叠时精确可见 4/5 行（3 条最近 + 1 条失败项 e1，它不在"最近三条"窗口内也依然真实可见）；折叠按钮文案「${ta.totalLabel}」`
      )
    } else {
      fail(5, `折叠态：${turnAState}`)
    }

    // ── 断言 10：失败项与成功项的 computed style 有可辨识差异 ───────────────────
    const styleDiff = await cdp.eval(`(function(){
      const t = ${TURN_A_FIND}
      if (!t) return null
      const failed = t.querySelector('.ac-exec-row.ac-exec-failed')
      const ok = t.querySelector('.ac-exec-row.ac-exec-ok')
      if (!failed || !ok) return null
      failed.scrollIntoView({ block: 'center' })
      const fr = failed.getBoundingClientRect()
      const hit = document.elementFromPoint(fr.left + fr.width/2, fr.top + fr.height/2)
      const csFailed = getComputedStyle(failed)
      const csOk = getComputedStyle(ok)
      return JSON.stringify({
        failedBg: csFailed.backgroundColor,
        okBg: csOk.backgroundColor,
        failedColor: csFailed.color,
        okColor: csOk.color,
        failedBorder: csFailed.borderColor,
        okBorder: csOk.borderColor,
        hitFailedRow: !!hit && !!hit.closest('.ac-exec-row.ac-exec-failed')
      })
    })()`)
    if (!styleDiff) {
      fail(10, 'Turn A 里没能同时找到 .ac-exec-failed 与 .ac-exec-ok 两行')
    } else {
      const sd = JSON.parse(styleDiff)
      const diffs = []
      if (sd.failedBg !== sd.okBg) diffs.push('background-color')
      if (sd.failedColor !== sd.okColor) diffs.push('color')
      if (sd.failedBorder !== sd.okBorder) diffs.push('border-color')
      if (diffs.length > 0 && sd.hitFailedRow) {
        pass(
          10,
          `computed style 差异字段：${diffs.join('/')}（失败行 bg=${sd.failedBg} color=${sd.failedColor} border=${sd.failedBorder}；成功行 bg=${sd.okBg} color=${sd.okColor} border=${sd.okBorder}）；elementFromPoint 命中失败行本身`
        )
      } else {
        fail(10, `差异字段=${diffs.join('/') || '无'} hitFailedRow=${sd.hitFailedRow} 详情=${styleDiff}`)
      }
    }

    // 展开 Turn A，确认全部 5 项可见（附加验证，不是硬性 11 条之一，但顺手做）
    await cdp.clickElement(`(${TURN_A_FIND})?.querySelector('.ac-execs-toggle')`, 'Turn A 的展开按钮')
    await sleep(150)
    const turnAExpanded = await cdp.eval(`(${TURN_A_FIND})?.querySelectorAll('.ac-exec-row').length ?? 0`)
    log(`  · Turn A 展开后可见 ${turnAExpanded}/5 行`)

    // Turn B：4 个全部成功的工具调用——验证「默认三行」这个基准形态（无失败项干扰）。
    await push({ k: 'text.done', text: '第二步：又跑了 4 个只读检查，都通过。' })
    await push({ k: 'exec.start', execId: 'e6', label: '检查 a.txt', detail: '{}' })
    await push({ k: 'exec.done', execId: 'e6', ok: true, output: 'ok' })
    await push({ k: 'exec.start', execId: 'e7', label: '检查 b.txt', detail: '{}' })
    await push({ k: 'exec.done', execId: 'e7', ok: true, output: 'ok' })
    await push({ k: 'exec.start', execId: 'e8', label: '检查 c.txt', detail: '{}' })
    await push({ k: 'exec.done', execId: 'e8', ok: true, output: 'ok' })
    await push({ k: 'exec.start', execId: 'e9', label: '检查 d.txt', detail: '{}' })
    await push({ k: 'exec.done', execId: 'e9', ok: true, output: 'ok' })
    await sleep(200)

    const TURN_B_FIND = `Array.from(document.querySelectorAll('.ac-turn-assistant')).find(t => (t.querySelector('.ac-turn-text')?.textContent || '').includes('第二步'))`

    // ── 断言 4：模型文字显示、执行区默认三行、点击展开显示全部 ───────────────────
    // P2-2（跟 P1-1 同族）：text.includes(...) 只测 textContent，不受 display:none 之类
    // 影响——这里补上 __t8Visible 判据，"显示"这个词要落到"真的看得见"，不是"DOM 里有"。
    const turnBCollapsed = await cdp.eval(`(function(){
      const t = ${TURN_B_FIND}
      if (!t) return null
      const textEl = t.querySelector('.ac-turn-text')
      return JSON.stringify({
        text: textEl?.textContent || null,
        textVisible: window.__t8Visible(textEl),
        visibleCount: t.querySelectorAll('.ac-exec-row').length,
        toggleLabel: t.querySelector('.ac-execs-toggle')?.textContent || null
      })
    })()`)
    if (!turnBCollapsed) throw new Error('找不到 Turn B（text 含"第二步"的 assistant 轮次）')
    const tb = JSON.parse(turnBCollapsed)
    const modelTextShown = !!tb.text && tb.text.includes('第二步') && tb.textVisible
    const defaultThreeLines = tb.visibleCount === 3

    if (modelTextShown && defaultThreeLines) {
      await cdp.clickElement(`(${TURN_B_FIND})?.querySelector('.ac-execs-toggle')`, 'Turn B 的展开按钮')
      await sleep(150)
      const expandedCount = await cdp.eval(`(${TURN_B_FIND})?.querySelectorAll('.ac-exec-row').length ?? 0`)
      if (expandedCount === 4) {
        pass(
          4,
          `模型文字="${tb.text}"；折叠态默认 ${tb.visibleCount} 行（按钮「${tb.toggleLabel}」）；点击展开后 ${expandedCount}/4 行全部可见`
        )
      } else {
        fail(4, `折叠态 ${tb.visibleCount} 行符合预期，但展开后只有 ${expandedCount}/4 行`)
      }
    } else {
      fail(4, `modelTextShown=${modelTextShown} defaultThreeLines=${defaultThreeLines}（实际 ${tb.visibleCount} 行）text=${JSON.stringify(tb.text)}`)
    }

    // ── 断言 11：用户自己发的消息出现在界面上，且顺序正确 ────────────────────────
    // P1-1（评审实测假绿，这条是本轮最重的一条）：原判据只有 class 顺序 + textContent
    // 精确匹配——textContent 不受 display/visibility/opacity/尺寸影响。评审实测：给
    // .ac-turn-user 加 display:none !important 后断言 11 照常绿，日志还写"用户消息
    // 出现在第 1 个轮次"，而屏幕上那句话根本不存在。Ruling 2 原话是"用户自己的消息
    // **可见**且顺序正确"，可见这一半原来零覆盖——本仓库"渲染完美但真实鼠标全部穿透"
    // 那次事故的同族问题：DOM 对了不等于用户看得见。断言 8 一开始就做对了（尺寸 +
    // display + visibility + opacity 四件套），这里把同一套判据用 __t8Visible 接过来。
    const turnOrder = await cdp.eval(`JSON.stringify(
      Array.from(document.querySelectorAll('.ac-messages > .ac-turn')).map(t => {
        const textEl = t.querySelector('.ac-turn-text')
        return {
          role: t.classList.contains('ac-turn-user') ? 'user' : (t.classList.contains('ac-turn-assistant') ? 'assistant' : 'other'),
          text: textEl?.textContent || '',
          visible: window.__t8Visible(textEl)
        }
      })
    )`)
    const turns = JSON.parse(turnOrder)
    const userIdx = turns.findIndex((t) => t.role === 'user' && t.text === TEST_MESSAGE)
    const firstAssistantIdx = turns.findIndex((t) => t.role === 'assistant')
    const userVisible = userIdx !== -1 && turns[userIdx].visible
    if (userIdx !== -1 && userVisible && firstAssistantIdx !== -1 && userIdx < firstAssistantIdx) {
      pass(
        11,
        `用户消息出现在第 ${userIdx + 1} 个轮次（原文完整匹配，且真实可见——尺寸/display/visibility/opacity 四件套），首个 assistant 轮次在第 ${firstAssistantIdx + 1} 个——顺序正确；完整轮次序列：${turns.map((t) => t.role).join(' → ')}`
      )
    } else {
      fail(
        11,
        `userIdx=${userIdx} userVisible=${userVisible} firstAssistantIdx=${firstAssistantIdx}；轮次序列：${JSON.stringify(turns.map((t) => ({ role: t.role, text: t.text.slice(0, 30), visible: t.visible })))}`
      )
    }

    // ── 断言 6：approval.request 到达，卡片带结构且真实可见 ─────────────────────
    await push({
      k: 'approval.request',
      approvalId: 'appr-1',
      kind: 'exec',
      title: '执行命令：rm -rf /tmp/e2e-danger',
      detail: JSON.stringify({ command: 'rm -rf /tmp/e2e-danger' }),
      cwd: projectDir
    })
    const approvalUp = await waitFor(
      async () => await cdp.eval(`!!document.querySelector('.ac-messages .ac-approval')`),
      { timeout: 5000, desc: 'approval.request 后审批卡片出现' }
    )
    const cardStructure = await cdp.eval(`(function(){
      const card = document.querySelector('.ac-messages .ac-approval')
      if (!card) return null
      return JSON.stringify({
        title: card.querySelector('.ac-approval-title')?.textContent || null,
        hasAllowBtn: !!card.querySelector('.ac-approval-btn.allow'),
        hasDenyBtn: !!card.querySelector('.ac-approval-btn.deny'),
        cardVisible: window.__t8Visible(card)
      })
    })()`)
    if (approvalUp && cardStructure) {
      const cs6 = JSON.parse(cardStructure)
      if (cs6.hasAllowBtn && cs6.hasDenyBtn && cs6.cardVisible) {
        pass(6, `卡片出现，title="${cs6.title}"，含允许/拒绝按钮，且真实可见（尺寸/display/visibility/opacity 四件套）`)
      } else {
        fail(6, `卡片结构或可见性不完整：${cardStructure}`)
      }
    } else {
      fail(6, '审批卡片没有出现')
    }

    // ── 断言 9：elementFromPoint 命中卡片本身——最大化 + 普通画布节点两种形态都测 ──
    // P1-3（评审：原来的场景是唯一不可能失败的那个）：.ac-approval 本身没有 z-index/
    // position 声明，就是文档流里一个普通块；最大化沉浸态又恰好排除了唯一可能盖住它
    // 的东西（RunMonitor/BuildStamp 主动让位，报告原话"没有别的东西盖在上面干扰点击"）
    // ——单测最大化态等于没测到任何真实层级规则。这里先在最大化态测一次，再退出沉浸态、
    // 在用户真正会遇到的形态（画布上未最大化的节点，可能被 frame 头/其它浮层压住）
    // 里把同一个断言重新跑一遍，两边都命中才算过。
    let hit9a = false
    let hit9aDetail = '最大化态：审批卡片没有出现，未测'
    if (approvalUp) {
      const j = await cdp.eval(`(function(){
        const card = document.querySelector('.ac-messages .ac-approval')
        if (!card) return null
        card.scrollIntoView({ block: 'center' })
        const r = card.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return JSON.stringify({ hitIsCard: false, hitTag: '(rect 尺寸为 0)' })
        const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)
        return JSON.stringify({ hitIsCard: !!hit && (hit === card || !!hit.closest('.ac-approval')), hitTag: hit ? hit.tagName + '.' + (hit.className || '') : null })
      })()`)
      if (j) {
        const p = JSON.parse(j)
        hit9a = p.hitIsCard
        hit9aDetail = `最大化态命中 ${p.hitTag}`
      }
    }

    await cdp.eval(`(function(){ window.__store.getState().setMaximizedNode(null); return true })()`)
    await sleep(500)
    const cardStillThere = await waitFor(
      async () => await cdp.eval(`!!document.querySelector('.ac-messages .ac-approval')`),
      { timeout: 5000, desc: '退出最大化后审批卡片应仍在（还没点允许/拒绝）' }
    ).catch(() => false)
    let hit9b = false
    let hit9bDetail = '非最大化态：退出最大化后审批卡片找不到了（可能被裁剪/隐藏——这本身就是需要关注的信号）'
    if (cardStillThere) {
      const j2 = await cdp.eval(`(function(){
        const card = document.querySelector('.ac-messages .ac-approval')
        if (!card) return null
        card.scrollIntoView({ block: 'center' })
        const r = card.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return JSON.stringify({ hitIsCard: false, hitTag: '(rect 尺寸为 0)' })
        const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)
        return JSON.stringify({ hitIsCard: !!hit && (hit === card || !!hit.closest('.ac-approval')), hitTag: hit ? hit.tagName + '.' + (hit.className || '') : null })
      })()`)
      if (j2) {
        const p2 = JSON.parse(j2)
        hit9b = p2.hitIsCard
        hit9bDetail = `非最大化态命中 ${p2.hitTag}`
      }
    }

    if (hit9a && hit9b) {
      pass(9, `${hit9aDetail}；${hit9bDetail}——最大化与普通画布节点两种形态下都命中卡片本身，未被穿透`)
    } else {
      fail(9, `${hit9aDetail}；${hit9bDetail}`)
    }

    // ── 断言 7：点「允许」后卡片消失，且决定真的发出去了（非最大化态，真实坐标）──
    // P1-2（评审实测假绿）：原判据只看 .ac-approval 从 DOM 消失，而那个隐藏完全由
    // ApprovalCard 的本地 state（decided）决定——评审删掉真正的 onDecide(decision) 调用，
    // 断言照样绿；也分不出点的是「允许」还是「拒绝」（点 deny 同样让卡片消失、同样绿）。
    // resolveApproval 在测试模式下仍然真调用 IPC，只是顺手记一份参数快照（见 preload
    // 补丁），这里读回来确认「决定真的从渲染层发出去了，且是正确的那个 decision」。
    if (cardStillThere) {
      await cdp.clickElement(
        `document.querySelector('.ac-messages .ac-approval .ac-approval-btn.allow')`,
        '审批卡片「允许」按钮（非最大化态）'
      )
      const cardGone = await waitFor(
        async () => {
          const still = await cdp.eval(`!!document.querySelector('.ac-messages .ac-approval')`)
          return still ? null : true
        },
        { timeout: 3000, desc: '点击「允许」后卡片应消失' }
      ).catch(() => false)
      const callsJson = await cdp.eval(
        `JSON.stringify(window.__agentChatTestGetResolveApprovalCalls ? window.__agentChatTestGetResolveApprovalCalls() : null)`
      )
      const calls = callsJson ? JSON.parse(callsJson) : null
      const gotExpectedCall =
        Array.isArray(calls) && calls.some((c) => c.sessionId === SESSION_ID && c.approvalId === 'appr-1' && c.decision === 'allow')
      if (cardGone && gotExpectedCall) {
        pass(
          7,
          `点击「允许」后 .ac-approval 立即消失（乐观隐藏）；且 resolveApproval 确实被真实调用，记录到 (${SESSION_ID}, appr-1, allow)——决定真的离开了渲染层，不是只有本地 state 变了`
        )
      } else {
        fail(7, `cardGone=${cardGone} gotExpectedCall=${gotExpectedCall} 实际记录的调用=${callsJson}`)
      }
    } else {
      skip(7, '退出最大化后审批卡片找不到了，没有可点的卡片')
    }

    // 附加验证（不是硬性 11 条之一，但直接回应 P1-2 提到的"分不出 allow 和 deny"）：
    // 再来一张卡片，这次点拒绝，确认记录到的 decision 真的是 'deny' 不是 'allow'。
    await push({ k: 'approval.request', approvalId: 'appr-2', kind: 'patch', title: '修改文件：danger.txt', detail: '{}', cwd: projectDir })
    const card2Up = await waitFor(async () => await cdp.eval(`!!document.querySelector('.ac-messages .ac-approval')`), {
      timeout: 5000,
      desc: '第二张审批卡片应出现'
    }).catch(() => false)
    if (card2Up) {
      await cdp.clickElement(`document.querySelector('.ac-messages .ac-approval .ac-approval-btn.deny')`, '第二张审批卡片「拒绝」按钮')
      await sleep(300)
      const calls2Json = await cdp.eval(`JSON.stringify(window.__agentChatTestGetResolveApprovalCalls())`)
      const calls2 = JSON.parse(calls2Json)
      const gotDeny = calls2.some((c) => c.approvalId === 'appr-2' && c.decision === 'deny')
      log(`  · 附加验证：点「拒绝」记录到的决定是否为 deny —— ${gotDeny}（P1-2 原话"分不出 allow 和 deny"，这里证实能分）`)
    } else {
      log('  · 附加验证：第二张审批卡片没有出现，跳过 allow/deny 区分验证')
    }

    // ── 断言 8：{k:'error',fatal:false} 的 notice 在界面上可见（硬验收项）──────────
    const NOTICE_TEXT = '审批保护未开启：hook 安装失败（task-8 e2e 模拟）'
    await push({ k: 'error', message: NOTICE_TEXT, fatal: false })
    const noticeCheck = await waitFor(
      async () => {
        const j = await cdp.eval(`(function(){
          const nodes = Array.from(document.querySelectorAll('.ac-toolbar .ac-notices .ac-notice'))
          const n = nodes.find(el => el.textContent === ${JSON.stringify(NOTICE_TEXT)})
          if (!n) return null
          const r = n.getBoundingClientRect()
          const cs = getComputedStyle(n)
          return JSON.stringify({
            isFatalClass: n.classList.contains('ac-notice-fatal'),
            visibleSize: r.width > 0 && r.height > 0,
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity
          })
        })()`)
        return j ? JSON.parse(j) : null
      },
      { timeout: 5000, desc: "notice（fatal:false）应出现在 .ac-toolbar 里" }
    )
    const genuinelyVisible =
      noticeCheck.visibleSize && noticeCheck.display !== 'none' && noticeCheck.visibility !== 'hidden' && Number(noticeCheck.opacity) > 0
    if (!noticeCheck.isFatalClass && genuinelyVisible) {
      pass(8, `notice 文本原样出现在 .ac-toolbar .ac-notices 里，非 fatal 样式（无 .ac-notice-fatal），尺寸/display/visibility/opacity 均确认真实可见`)
    } else {
      fail(8, `isFatalClass=${noticeCheck.isFatalClass} genuinelyVisible=${genuinelyVisible} 详情=${JSON.stringify(noticeCheck)}`)
    }
    // 顺手验一下 fatal:true 用的是另一套样式（不是硬性 11 条之一，锦上添花）
    await push({ k: 'error', message: 'task-8 e2e：模拟一条 fatal 提示', fatal: true })
    await sleep(200)
    const fatalClassSeen = await cdp.eval(`!!document.querySelector('.ac-toolbar .ac-notices .ac-notice-fatal')`)
    log(`  · fatal:true 的 notice 带上了 .ac-notice-fatal：${fatalClassSeen}`)

    // ── P2-1（评审加做）：approval 为空的 CLI 路径此前零真机覆盖 ─────────────────
    // 前面全程只测了第一个 CLI 芯片（本机是 Claude Code，capabilities.approval 非空），
    // 于是 toolbarModel 的 `showSandbox = caps.approval.length===0 && sandboxLevels.length>0`
    // 这一支——本项目全局硬约束之一（approval 为空时必须显示 sandboxLevels）——在真实
    // 浏览器里从没渲染过；同理 hookAsk 询问卡片只在 approval 非空时才问，"不问 hook、
    // 直接起会话"这条路径也没跑过。这里用第二个独立节点（同一组件实例的内部 state
    // 不会因为改 store 数据就重置，不能复用 Node A）重跑一遍，选第二个 CLI 芯片
    // （本机是 Codex，capabilities.approval 为空）。
    const extra = { p21: { status: 'not-run', detail: '' } }
    try {
      const IDS_B = { tabId: 't8-tab-b', leafId: 't8-leaf-b', frameId: 't8-frame-b', nodeId: 't8-node-b' }
      const injectB = await cdp.eval(`(function(){
        const s = window.__store.getState()
        window.__store.setState({
          tabs: [...s.tabs, {
            id: ${JSON.stringify(IDS_B.tabId)}, title: 'agent-e2e-b', projectId: null,
            cwd: ${JSON.stringify(projectDir)},
            root: { type: 'leaf', id: ${JSON.stringify(IDS_B.leafId)}, pane: { kind: 'agent', cwd: ${JSON.stringify(projectDir)} } },
            activeLeafId: ${JSON.stringify(IDS_B.leafId)}
          }],
          canvas: {
            ...s.canvas,
            frames: [...s.canvas.frames, {
              id: ${JSON.stringify(IDS_B.frameId)}, projectId: null, name: 'agent-e2e-frame-b',
              x: 1200, y: 0, w: 900, h: 700, collapsed: false,
              nodes: [{ id: ${JSON.stringify(IDS_B.nodeId)}, leafId: ${JSON.stringify(IDS_B.leafId)}, x: 20, y: 50, w: 820, h: 600 }]
            }]
          }
        })
        window.__store.getState().setMaximizedNode({ frameId: ${JSON.stringify(IDS_B.frameId)}, nodeId: ${JSON.stringify(IDS_B.nodeId)} })
        return true
      })()`)
      if (!injectB) throw new Error('Node B 注入失败')
      await sleep(400)

      const emptyStateB = await waitFor(
        async () => {
          const j = await cdp.eval(`(function(){
            const root = document.querySelector('.agent-chat-view .ac-empty')
            if (!root) return null
            const chips = root.querySelectorAll('.ac-clis .ac-cli-chip')
            return JSON.stringify({ count: chips.length, labels: Array.from(chips).map(c => c.textContent) })
          })()`)
          if (!j) return null
          const p = JSON.parse(j)
          return p.count >= 2 ? p : null
        },
        { timeout: 8000, desc: 'Node B 空态且至少 2 个 CLI 选项' }
      )
      log(`  · Node B CLI 选项：${emptyStateB.labels.join(' / ')}`)

      await cdp.clickElement(
        `document.querySelectorAll('.ac-clis .ac-cli-chip')[1]`,
        'Node B 第二个 CLI 选择芯片（预期 approval 为空，如 Codex）'
      )
      const selectedB = await cdp.eval(`document.querySelector('.ac-cli-chip.selected')?.textContent || null`)
      log(`  · Node B 已选中：${selectedB}`)

      await cdp.clickElement(`document.querySelector('textarea.ac-input')`, 'Node B 空态输入框')
      await cdp.send('Input.insertText', { text: 'ping（P2-1 验证脚本发送）' })
      await sleep(100)
      await cdp.clickElement(`document.querySelector('button.ac-send')`, 'Node B「发送」按钮')

      // approval 为空的 CLI 不该走 hookStatus() 查询那个分支——立刻查一次，
      // 不该看到 hook 询问卡片（不是等它超时不出现，是确认这条分支真的没走到）。
      await sleep(400)
      const hookAskAppearedB = await cdp.eval(`!!document.querySelector('.ac-hook-ask')`)

      const conversationUpB = await waitFor(
        async () => await cdp.eval(`!!document.querySelector('.agent-chat-view .ac-messages')`),
        { timeout: 8000, desc: 'Node B 切到对话态' }
      )

      const sandboxCheck = await waitFor(
        async () => {
          const j = await cdp.eval(`(function(){
            const el = document.querySelector('.ac-toolbar .ac-sandbox-note')
            if (!el) return null
            return JSON.stringify({ text: el.textContent, visible: window.__t8Visible(el) })
          })()`)
          return j ? JSON.parse(j) : null
        },
        { timeout: 5000, desc: 'Node B 工具栏应显示 .ac-sandbox-note' }
      ).catch((e) => ({ text: null, visible: false, error: e.message }))

      const ok = conversationUpB && !hookAskAppearedB && sandboxCheck?.visible && !!sandboxCheck.text
      extra.p21 = {
        status: ok ? 'PASS' : 'FAIL',
        detail: `CLI=${selectedB}；hookAsk 出现=${hookAskAppearedB}（预期 false）；对话态=${conversationUpB}；沙箱提示="${sandboxCheck?.text}" 可见=${sandboxCheck?.visible}`
      }
      log(`  ${ok ? '✓' : '✗'} [P2-1] approval 为空的 CLI 路径（不问 hook + 显示 sandboxLevels）—— ${extra.p21.detail}`)
    } catch (e) {
      extra.p21 = { status: 'FAIL', detail: '异常：' + e.message }
      log(`  ✗ [P2-1] 异常：${e.message}`)
    }
    results.__extra = extra

    // ── 渲染层报错检查（不是 11 条之一，但值得报告）──────────────────────────────
    if (cdp.consoleErrors.length > 0) {
      log(`  ⚠ 渲染层控制台出现 ${cdp.consoleErrors.length} 条 error/异常（详见报告）：`)
      cdp.consoleErrors.slice(0, 5).forEach((e) => log('    -', e.slice(0, 200)))
    } else {
      log('  · 全程渲染层控制台无 error/异常')
    }

    results.__consoleErrors = cdp.consoleErrors
  } finally {
    // ── 收尾：只杀自己起的这个 PID；把源码还原；重新构建；清理临时目录 ────────────
    if (ws) {
      try {
        ws.close()
      } catch {
        /* 忽略 */
      }
    }
    if (proc && proc.pid) {
      log(`▸ 关闭隔离实例（组长 PID ${proc.pid}，只杀这一棵自己起的进程树，不影响用户正在用的 Eas-Term）`)
      // node_modules/.bin/electron 是包装脚本，proc.pid 只是它自己的 PID，真正的
      // Electron.app 是它的子进程——用进程组 kill 才能连子进程一起带走，见
      // killIsolatedInstance 的注释（自查时发现：单杀 proc.pid 在 SIGKILL 那一步会
      // 让真正的 Electron.app 变孤儿，SIGTERM 那一步因为包装脚本有转发逻辑侥幸不会）。
      killIsolatedInstance(proc, 'SIGTERM')
      await sleep(800)
      killIsolatedInstance(proc, 'SIGKILL')
    }
    // P0-1：无条件还原 + 无条件重新构建，不靠任何"是否已经改过/是否已经构建过"的
    // 标志去判断要不要做——ORIGINALS 在 main() 一开始就读好了，写回同样的内容、
    // 重建同样的产物，在"其实什么都没改"的情况下都只是无害的 no-op。
    log('▸ 还原临时补丁的两个源文件…')
    restoreSources(ORIGINALS)
    try {
      runBuild('还原后重新构建，确保仓库产物与源码一致')
    } catch (e) {
      console.error('⚠ 还原后重新构建失败，请手动检查 npm run build：', e.message)
    }
    for (const d of [userDataDir, projectDir]) {
      if (d) {
        try {
          fs.rmSync(d, { recursive: true, force: true })
        } catch {
          /* 留着也无妨 */
        }
      }
    }
  }
}

main()
  .then(() => {
    log('')
    log('=== 十一条断言结果 ===')
    let allPass = true
    for (const id of Object.keys(ASSERTION_NAMES)) {
      const r = results[id]
      if (r.status !== 'PASS') allPass = false
      log(`  [${r.status.padEnd(7)}] 断言${id}：${ASSERTION_NAMES[id]}`)
    }
    // P2-1：不在原计划的十一条编号里（那十一条是计划 8 条 + Ruling 2 追加 3 条，
    // 编号已经固定），但评审要求补做、也计入"是否全绿"——不达标同样让脚本以非零
    // exit code 收尾，不能只印在日志里就当没发生。
    const p21 = results.__extra?.p21
    if (p21) {
      log('')
      log('=== 附加检查（P2-1，评审加做，不占用 1-11 编号）===')
      log(`  [${p21.status.padEnd(7)}] approval 为空的 CLI 路径（不问 hook + 显示 sandboxLevels）—— ${p21.detail}`)
      if (p21.status !== 'PASS') allPass = false
    }
    log('')
    log(allPass ? '✓ 十一条 + P2-1 全部通过' : '✗ 存在未通过的检查——如实报告，见上面逐条详情')
    process.exitCode = allPass ? 0 : 1
  })
  .catch((e) => {
    console.error('')
    console.error('✗ 脚本因异常中止：', e.stack || e.message)
    console.error('')
    console.error('=== 中止前已记录的断言结果 ===')
    for (const id of Object.keys(ASSERTION_NAMES)) {
      const r = results[id]
      console.error(`  [${r.status.padEnd(7)}] 断言${id}：${ASSERTION_NAMES[id]}${r.detail ? ' —— ' + r.detail : ''}`)
    }
    process.exitCode = 1
  })
