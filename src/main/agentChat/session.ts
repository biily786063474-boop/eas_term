// 会话进程管理。这一层是胶水：spawn / 喂行 / 推事件 / 定时回收。
// 「什么时候该回收」「该直接发还是重启 resume」「审批两路怎么缝」
// 全部由 sessionState.ts 与 approvalRegistry.ts / approvalRoute.ts 的纯函数回答——
// 那些才测得了。**任何 if 判断如果需要写测试，就说明它放错地方了，应该挪回纯函数那边。**
// 本文件不写单测（2026-08-14 Ruling 3：胶水层的接线错误交给 Task 9 的真实端到端验证兜底）。
//
// 消息怎么送到 CLI 手上，两边完全不同、且都不是「分支出来的」，而是由 adapter 声明的
// `stdin` 字段决定（唯一允许按 CLI 分支的地方是选 translator，见下）：
// - Claude（stdin:'pipe'）：进程常驻，多轮共用同一个进程，每条消息是一行
//   `{"type":"user","message":{"role":"user","content":"..."}}` 写进 stdin
//   （spec §A.3 实测过，claude.ts 的文件头也把这一步的责任明确交给了这一层）。
// - Codex（stdin:'ignore'）：`exec` 一次只吃一个 prompt 就退出，prompt 是**位置参数**，
//   不经 stdin（codex.ts 文件头已经写明）。这里的处理是通用规则「stdin 是 ignore 时，
//   把消息追加进 buildArgs() 返回的 args 末尾」——不是 `if (cli==='codex')`，是照 adapter
//   自己声明的 stdin 能力位来决定，第三个 CLI 只要照这个约定填 stdin 字段就能直接工作。
//   代价：`codex exec resume <id> --json --sandbox X -m M -c K=V "<prompt>"` 这个位置参数
//   跟在全部 flag 后面是否总能被正确解析，spike 只验证过不带 resume/-m/-c 的最简形态
//   （见 docs/cli-headless-接口实测.md），resume 分支与多 flag 组合未被真实跑过，
//   照 clap 系 CLI 的通用行为推断——若 Task 9 或后续实测发现不成立，这里要跟着改。
import { spawn, type ChildProcess } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, type WebContents } from 'electron'
import { getAdapter } from './adapters/index.ts'
import { createClaudeTranslator } from './claudeEvents.ts'
import { createCodexTranslator } from './codexEvents.ts'
import { createApprovalRegistry } from './approvalRegistry.ts'
import { onApprovalRequest, resolveApproval as resolveApprovalGlobal } from './approvalRoute.ts'
import { planHookInstall } from './hookInstall.ts'
import { shouldReap, planSend, applyParamChange, type SessionRecord } from './sessionState.ts'
import { guardPath } from '../fsGuard.ts'
import { mcpEnv } from '../mcpBridge.ts'
import type {
  ChatEvent,
  StartOpts,
  AgentChatStartParams,
  AgentChatStartResult,
  AgentChatSendResult
} from '../../shared/agentChat.ts'

interface Live {
  rec: SessionRecord
  proc?: ChildProcess
  translator: { push(line: string): ChatEvent[] }
  approvals: ReturnType<typeof createApprovalRegistry>
  stdoutBuf: string
  /** 这个会话的事件只推给创建它的那个 webContents——不是全窗口广播。
   *  和 pty.ts 的 `wc.send(pty:data:${id}, ...)` 同一个道理。 */
  wc: WebContents
}

const sessions = new Map<string, Live>()
let nextId = 1

/** 按行切分喂给 translator——stdout 的 chunk 边界不等于行边界，
 *  不缓冲的话会把一行 JSON 劈成两半，解析必然失败 */
function feed(live: Live, chunk: string, emit: (e: ChatEvent) => void): void {
  live.stdoutBuf += chunk
  const lines = live.stdoutBuf.split('\n')
  live.stdoutBuf = lines.pop() ?? ''
  for (const l of lines) {
    // 审批不经过这里——它由 hook 路单独驱动（见 Task 3 背景，实测两路无共同关联键）
    for (const e of live.translator.push(l)) emit(e)
  }
}

// ── hook 脚本的绝对路径 + 怎么跑它（Ruling 12：打包后找不到会让审批功能整个是死的） ──────

/** 照抄 mcpBridge.ts:99 serverScriptPath() 的样板：打包版资源在 process.resourcesPath 下，
 *  开发时在源码树的 resources/ 下（package.json 的 extraResources 已加上 agent-hooks 这一项，
 *  见本次改动）。 */
function hookScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'agent-hooks', 'eas-pretooluse.mjs')
    : path.join(app.getAppPath(), 'resources', 'agent-hooks', 'eas-pretooluse.mjs')
}

/** hook 脚本要用哪个 node 跑。镜像 mcpBridge.ts 的 runnerFor()：GUI 启动的 app PATH
 *  很贫瘠（常只有 /usr/bin:/bin），bare 'node' 未必解析得到。这里只需要单个可执行文件
 *  路径去拼 shell 命令字符串，不需要 runnerFor 完整的 spawn 语义（它返回给 MCP server
 *  配置用的 {command,args,env} argv 数组形式），所以本地建一份短的，不改 mcpBridge.ts
 *  的导出面。找不到候选路径就退回裸 'node'，寄望调用环境自己能解析。 */
function nodeBinForHook(): string {
  const candidates =
    process.platform === 'win32' ? [] : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* 试下一个 */
    }
  }
  return 'node'
}

/** hook 脚本本身没有可执行位（打包资源目录里的普通静态文件，见 resources/agent-hooks/
 *  的 git 记录），且开发路径可能含空格（本仓库就是一例：".../vibe coding/terminal"）——
 *  所以不依赖 shebang + chmod +x，显式用 node 解释器跑，并给两段路径都加引号，
 *  避免在空格处被 shell 切成多个 token。 */
function hookCommand(): string {
  const quote = (s: string): string => `"${s}"`
  return `${quote(nodeBinForHook())} ${quote(hookScriptPath())}`
}

/** 往 <cwd>/.claude/settings.json 装 PreToolUse hook。只有声明了逐次审批能力的 adapter
 *  才需要——目前只有 Claude，靠 `capabilities.approval.length > 0` 判断，不硬编码 cli id
 *  （跟这个仓库别处「能力声明驱动行为」的做法一致，调用点见 restartAndDeliver）。
 *
 *  这是用户自己的文件（spec §九 第 2 条 + hookInstall.ts 文件头）：
 *  - 读不出来（不存在/损坏）当空对象处理——planHookInstall 自己能吞坏形状，不在这里判断
 *  - 写之前必须过 fsGuard 的 guardPath 边界；cwd 不在任何已注册项目/知识库内时跳过不写，
 *    只打日志，不阻塞会话本身——没装上 hook 顶多是这个会话的审批走不了，
 *    不该连话都不让说
 *  - changed:false 时不写——那个函数是幂等的，每次启动都写没有意义，还会在用户
 *    手改过的文件上留下不必要的 diff（brief 原话："那个函数是幂等的，每次启动重复写没意义"） */
function installApprovalHook(cwd: string): void {
  const target = path.join(cwd, '.claude', 'settings.json')
  const g = guardPath(target)
  if (!g.ok) {
    console.error('[agentChat] 跳过 hook 安装（不在允许写入的目录内）：', g.error)
    return
  }
  let existing: unknown = {}
  try {
    existing = JSON.parse(fs.readFileSync(g.path, 'utf8'))
  } catch {
    existing = {} // 不存在 / 不是合法 JSON，都当空处理
  }
  const plan = planHookInstall(existing, hookCommand())
  if (!plan.changed) return
  try {
    fs.mkdirSync(path.dirname(g.path), { recursive: true })
    const tmp = g.path + '.eas-tmp'
    fs.writeFileSync(tmp, JSON.stringify(plan.next, null, 2), 'utf8')
    fs.renameSync(tmp, g.path)
  } catch (e) {
    console.error('[agentChat] hook 写入失败', e)
  }
}

// ── 事件推送 + 会话状态的机械式更新（不是判定，只是照实记录已经发生的事） ──────────────

function emitEvent(live: Live, e: ChatEvent): void {
  if (!live.wc.isDestroyed()) live.wc.send(`agentChat:event:${live.rec.id}`, e)
}

/** translator 产出的事件里，session.ready 携带了 CLI 原生的会话/线程 id——
 *  记下来才能在下次 restart 时 --resume 接上（决定 4）。其余事件原样转发，
 *  这不是"判定"，只是把已经发生的事实记进 SessionRecord。 */
function handleEvent(live: Live, e: ChatEvent): void {
  if (e.k === 'session.ready') {
    live.rec = { ...live.rec, resumeId: e.sessionId, alive: true, lastActiveAt: Date.now() }
  }
  emitEvent(live, e)
}

function findLiveByResumeId(nativeSessionId: string): Live | undefined {
  for (const live of sessions.values()) {
    if (live.rec.resumeId === nativeSessionId) return live
  }
  return undefined
}

/** Claude 走 stdin 送消息用的行格式（spec §A.3 实测确认）。这是 Claude 专有的 wire
 *  format，但只有一个 CLI 声明 stdin:'pipe'，所以不构成"按 cli 分支"——等哪天第二个
 *  stdin:'pipe' 的 CLI 接进来、且格式不一样，这里才需要真正分支，到时候再改。 */
function writeStdin(live: Live, message: string): void {
  if (!live.proc?.stdin) return
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: message } }) + '\n'
  try {
    live.proc.stdin.write(line)
  } catch {
    // 进程可能正在退出，写入失败不算致命——和 pty.ts 的 pty:write 同样的容错方式
  }
}

function wireProc(live: Live, proc: ChildProcess): void {
  proc.stdout?.setEncoding('utf8')
  proc.stdout?.on('data', (chunk: string) => {
    // 收到输出＝还活着，不是空闲——15 分钟空闲回收判的是「没交互」，一轮长任务
    // 跑再久也不该被当成空闲杀掉，所以每收到一块输出就续一次 lastActiveAt。
    live.rec = { ...live.rec, lastActiveAt: Date.now() }
    feed(live, chunk, (e) => handleEvent(live, e))
  })
  proc.stderr?.setEncoding('utf8')
  proc.stderr?.on('data', (chunk: string) => {
    // stderr 不做任何解读——那是"判定"，这一层不该猜它是不是致命。只留痕迹方便排障。
    console.error(`[agentChat:${live.rec.id}] stderr`, chunk)
  })
  proc.on('error', (err) => {
    live.rec = { ...live.rec, alive: false }
    handleEvent(live, { k: 'error', message: err.message, fatal: true })
  })
  proc.on('exit', (code) => {
    live.proc = undefined
    live.rec = { ...live.rec, alive: false }
    // code === 0 或 null（被我们自己 kill）都不算错——Codex 的 exec 正常跑完一轮后
    // 本来就会退出，那是预期行为，不是故障。
    if (code !== 0 && code !== null) {
      handleEvent(live, { k: 'error', message: `CLI 进程退出（code ${code}）`, fatal: true })
    }
  })
}

/** restart 分支：无条件先 kill 再 spawn（Ruling 8）。planSend 是纯函数、杀不了进程；
 *  若 alive 因系统休眠等原因滞后，不先 kill 就 spawn 会造成两个进程同时存活、
 *  stdout 都灌进同一个 translator。kill 是幂等的（已经死的进程再 kill 一次没有副作用），
 *  无脑调即可。 */
function restartAndDeliver(live: Live, opts: StartOpts, message: string): void {
  live.proc?.kill()
  live.proc = undefined

  const adapter = getAdapter(live.rec.cli)
  if (!adapter) {
    handleEvent(live, { k: 'error', message: `未知 CLI：${live.rec.cli}`, fatal: true })
    return
  }

  // 只有声明了逐次审批能力的 adapter 才需要装 PreToolUse hook——见 installApprovalHook 文件头。
  if (adapter.capabilities.approval.length > 0) {
    installApprovalHook(live.rec.cwd)
  }

  const built = adapter.buildArgs(opts)
  // stdin:'ignore' 的 CLI（目前是 Codex）没有活跃的 stdin 通道，prompt 只能是位置参数，
  // 追加在 buildArgs() 已经拼好的 args 末尾——见文件头说明，这是能力位驱动而非 CLI 分支。
  const args = built.stdin === 'ignore' ? [...built.args, message] : built.args

  let proc: ChildProcess
  try {
    proc = spawn(built.bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...mcpEnv({ project: opts.cwd }) },
      stdio: [built.stdin, 'pipe', 'pipe']
    })
  } catch (e) {
    handleEvent(live, { k: 'error', message: e instanceof Error ? e.message : String(e), fatal: true })
    return
  }

  live.proc = proc
  live.stdoutBuf = ''
  live.rec = {
    ...live.rec,
    model: opts.model,
    effort: opts.effort,
    sandbox: opts.sandbox,
    pending: undefined, // 待生效参数这一刻已经生效，清掉——不清的话 UI 的「下条起生效」标注永远摘不掉
    alive: true,
    lastActiveAt: Date.now()
  }

  wireProc(live, proc)

  // stdin:'pipe' 的 CLI（目前是 Claude）：进程起来后把这条消息按它的 wire format 写进去。
  // 'ignore' 的已经在上面把消息塞进了位置参数，这里不用再写。
  if (built.stdin === 'pipe') writeStdin(live, message)
}

/** 送一条消息该怎么送，全部问 planSend——这里只负责照做。
 *  唯一的自主判断是「action 是 send，但进程当下其实没有可写的 stdin」这种不可能通过
 *  纯函数判出来的运行时状态（比如 Codex 的上一轮还没退出、stdin 本来就是 ignore），
 *  这不是业务判定，是"我有没有能力执行这个动作"的机械检查，答不了就如实报错，
 *  不能假装写成功了却悄悄把消息丢了。 */
function deliverMessage(live: Live, message: string): AgentChatSendResult {
  const plan = planSend(live.rec, Date.now())
  if (plan.action === 'send') {
    if (!live.proc?.stdin) {
      return { ok: false, error: '当前会话正在处理上一条消息，请稍候再发送' }
    }
    writeStdin(live, message)
    live.rec = { ...live.rec, lastActiveAt: Date.now() }
    return { ok: true }
  }
  restartAndDeliver(live, plan.opts, message) // 失败会经 error ChatEvent 异步通知，这里不等
  return { ok: true }
}

// ── 定时回收：判据来自 shouldReap，这里只负责杀进程与标记 ─────────────────────────

function reapIdleSessions(): void {
  const now = Date.now()
  for (const live of sessions.values()) {
    if (!shouldReap(live.rec, now)) continue
    live.proc?.kill()
    live.proc = undefined
    live.rec = { ...live.rec, alive: false } // resumeId 保留，下次发送时接上
  }
}

/** app 退出时收掉全部会话进程，避免留下孤儿（和 pty.ts 的 killAllPtys 同一个道理）。
 *  hard=true 用 SIGKILL，配合 index.ts 里"先软杀、300ms 后硬杀"的两拍节奏。 */
export function killAllAgentChatSessions(hard = false): void {
  for (const live of sessions.values()) {
    live.proc?.kill(hard ? 'SIGKILL' : 'SIGTERM')
  }
}

export function registerAgentChatHandlers(): void {
  setInterval(reapIdleSessions, 60_000)

  // 全局唯一订阅：hook 脚本送来的每一条待审批请求都会广播到这里，按 tool_use_id 对应的
  // 原生会话 id 找到我们自己的会话记录（resumeId），转成 approval.request 推给对应的
  // webContents。找不到匹配会话就丢弃——不是我们管的会话（比如同一台机器上给别的
  // 项目开的 hook），hook 那边自己的 5 分钟超时会兜底 deny，不会静默放行。
  onApprovalRequest((payload) => {
    const live = findLiveByResumeId(payload.session_id)
    if (!live) return
    for (const e of live.approvals.fromHook(payload)) emitEvent(live, e)
  })

  ipcMain.handle('agentChat:start', (e, params: unknown): AgentChatStartResult => {
    const p = params as Partial<AgentChatStartParams> | null
    if (!p || typeof p.cli !== 'string' || typeof p.cwd !== 'string' || typeof p.message !== 'string' || !p.message) {
      return { ok: false, error: '缺少必需参数（cli / cwd / message）' }
    }
    const adapter = getAdapter(p.cli)
    if (!adapter) return { ok: false, error: `未知 CLI：${p.cli}` }

    const id = `ac-${nextId++}`
    const rec: SessionRecord = {
      id,
      cli: p.cli,
      cwd: p.cwd,
      alive: false,
      lastActiveAt: Date.now(),
      model: typeof p.model === 'string' ? p.model : undefined,
      effort: typeof p.effort === 'string' ? p.effort : undefined,
      sandbox: typeof p.sandbox === 'string' ? p.sandbox : undefined,
      resumeId: typeof p.resumeId === 'string' ? p.resumeId : undefined
    }
    const live: Live = {
      rec,
      wc: e.sender,
      // 唯一允许按 CLI 分支的地方（选 translator），见文件头与 task-8-brief 的明确许可。
      translator: adapter.id === 'codex' ? createCodexTranslator() : createClaudeTranslator(),
      approvals: createApprovalRegistry(),
      stdoutBuf: ''
    }
    sessions.set(id, live)
    deliverMessage(live, p.message) // 首次投递等价于「进程不活 → restart」，spawn 失败经 error 事件异步通知
    return { ok: true, sessionId: id }
  })

  ipcMain.handle('agentChat:send', (_e, sessionId: unknown, message: unknown): AgentChatSendResult => {
    const live = sessions.get(typeof sessionId === 'string' ? sessionId : '')
    if (!live) return { ok: false, error: '会话不存在（可能已被关闭）' }
    if (typeof message !== 'string' || !message) return { ok: false, error: '消息不能为空' }
    return deliverMessage(live, message)
  })

  // 中途改模型/effort：只记为待生效，不打断当前任务（决定 3）。下一次 send 触发的
  // planSend 会因为 pending 存在而走 restart，effectiveOpts 会把这里 patch 的值带上。
  ipcMain.handle('agentChat:setParams', (_e, sessionId: unknown, patch: unknown): { ok: boolean; error?: string } => {
    const live = sessions.get(typeof sessionId === 'string' ? sessionId : '')
    if (!live) return { ok: false, error: '会话不存在' }
    const p = (patch ?? {}) as { model?: unknown; effort?: unknown }
    const clean: { model?: string; effort?: string } = {}
    if (typeof p.model === 'string') clean.model = p.model
    if (typeof p.effort === 'string') clean.effort = p.effort
    live.rec = applyParamChange(live.rec, clean)
    return { ok: true }
  })

  // 审批决定回传：sessionId 只用来找到我们自己这边要推的 approval.resolved 事件；
  // 真正解开 hook 脚本阻塞的是下面这个全局 resolveApprovalGlobal（按 approvalId 单独一张表，
  // 见 approvalRoute.ts）。两者独立处理——找不到本地会话不代表不该去解锁 hook，
  // 反过来也一样，谁失败都不该连累另一个。
  ipcMain.handle(
    'agentChat:resolveApproval',
    (_e, sessionId: unknown, approvalId: unknown, decision: unknown): { ok: boolean } => {
      const d: 'allow' | 'deny' = decision === 'allow' ? 'allow' : 'deny'
      const aid = typeof approvalId === 'string' ? approvalId : ''
      const live = sessions.get(typeof sessionId === 'string' ? sessionId : '')
      if (live) {
        for (const e of live.approvals.resolve(aid, d)) emitEvent(live, e)
      }
      return { ok: resolveApprovalGlobal(aid, d, '') }
    }
  )

  ipcMain.on('agentChat:stop', (_e, sessionId: unknown) => {
    const id = typeof sessionId === 'string' ? sessionId : ''
    const live = sessions.get(id)
    if (!live) return
    sessions.delete(id)
    live.proc?.kill()
  })
}
