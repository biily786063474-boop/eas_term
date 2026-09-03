// omp 那条路的传输层：一条**双向** JSON-RPC over stdio（ACP）。
//
// ── 为什么它不能复用既有那条路 ──────────────────────────────────────────────
// `session.ts` 的既有形状是「stdout 逐行喂翻译器、stdin 写 CLI 自己的 wire format」，
// 两个假设在 ACP 上都不成立：
//   · `session.ts:159` 是 `for (const e of live.translator.push(l)) emit(e)` ——
//     它假定翻译器只回一个事件数组。ACP 的翻译器要回 `{events, reply}`，
//     `reply` 不写回去，`session/prompt` 就**挂死**（实测 180 秒才超时）。
//   · `writeStdin()`（`session.ts:407`）硬写 Claude 的 `{type:'user',…}` 行。
// 所以 omp 整条走这里，`feed()` 与 `writeStdin()` 一个字节都不碰。
//
// ── 这个文件必须 electron-free ──────────────────────────────────────────────
// 它要能在 `node --test` 下裸跑（假 ACP 服务端回放报文），所以进程怎么起、密钥柜、
// MCP 桥、`app.getVersion()` **全部靠 `AcpDeps` 注入**。
// `omp/launch.ts` 才是允许 import electron 的那一层。
// 这条边界由 `scripts/verify-agent-chat.mjs` 的静态检查钉住。
// 同理：不许用 TS 参数属性（`constructor(public x)`）—— node 的 strip-only 模式不支持。
//
// ── 一条时间线 ──────────────────────────────────────────────────────────────
//   dead ──open──▶ opening ──握手完──▶ ready ──发 prompt──▶ prompting ──响应到──▶ ready
//                                                                    └──进程没了──▶ dead
// `opening` / `prompting` 期间到达的用户消息**排队**，不拒收 ——
// Claude 那条路在忙时也是照收的（`planSend` 返回 send、直接写 stdin），
// 同一个界面上两个 CLI 行为不一致，用户只会当成 omp 有 bug。
// 而 omp 自己内部也排队（上游 `acp-agent.ts:175` 的 promptQueue），
// 我们在这一层排是为了守住「同一时刻只有一个 prompt 在飞」——
// `turn.done` 的配对与 `reduce.ts` 的单槽 pending 都建立在这个不变量上。
import type { ChatEvent } from '../../../shared/agentChat'
import {
  createOmpTranslator,
  fromConfigOptions,
  type AcpCapabilities,
  type ApprovalAsk,
  type ApprovalDecision,
  type OmpTranslator
} from '../ompEvents.ts'
import { createAcpApprovals, type AcpApprovals } from './approvals.ts'

/** 我们对进程的全部要求。**只要这几件事** —— 真实实现包一层 `child_process`，
 *  测试实现是个假 agent，两边都不需要认识对方。 */
export interface AcpProcess {
  write(line: string): void
  onLine(cb: (line: string) => void): void
  onStderr(cb: (chunk: string) => void): void
  onExit(cb: (code: number | null, signal: string | null) => void): void
  kill(): void
  /** 排障用。**只给日志**，别拿它去杀进程 —— 杀这件事只走 `kill()`，
   *  免得出现「按 pid 杀」和「按句柄杀」两条路（3B 的杀进程纪律：只认自己起的那一个）。 */
  pid?: number
}

/** ACP 的 `session/new` 收的 MCP 服务器条目。
 *  **`env` 是数组不是对象、而且必填**：上游 `acp-agent.ts:2716-2722` 的 `#toNameValueMap`
 *  无条件遍历它，省掉就是 TypeError（而且 ACP 的 schema 只校验 agent→client 的响应，
 *  请求这一侧没有友好报错）。 */
export interface AcpMcpServer {
  name: string
  command: string
  args?: string[]
  env: { name: string; value: string }[]
}

export interface AcpDeps {
  /** 起进程。失败时的 `message` 会原样进 `{k:'error'}`，`setup` 决定它是不是
   *  「去设置」那一类（`kind:'setup'`）而不是普通报错。 */
  open(cwd: string): { ok: true; proc: AcpProcess } | { ok: false; message: string; setup: boolean }
  emit(e: ChatEvent): void
  log(msg: string): void
  /** 客户端版本，握手时报给对方。注入而不是自己取 —— `app.getVersion()` 要 electron */
  clientVersion: string
  /** 这个会话要带的 MCP 服务器。**同一份来源**（`agentMcpConfigPath` 写出的那份 JSON），
   *  不另写第二份配置；用户在「扩展能力」里关掉 MCP，下一次 `session/new` 就跟着不带 */
  mcpServers(): AcpMcpServer[]
  now(): number
}

/** 握手与首轮的超时。`session/prompt` **刻意不设** —— 一轮可以跑几小时，
 *  该管它的是空闲回收（`sessionState.ts` 的三档阈值），不是这里。 */
const OPEN_TIMEOUT_MS = 30_000
const CONFIG_TIMEOUT_MS = 10_000
/** 发完 `session/cancel` 等那条 prompt 响应的上限。
 *  上游 `acp-agent.ts:1091-1103` 收到 cancel 会**立刻**以 `stopReason:'cancelled'` 回响应
 *  （后台再跑最多 5s 的清理），所以这里等的是「立刻」而不是「清理完」。 */
const CANCEL_WAIT_MS = 3_000

type Phase = 'dead' | 'opening' | 'ready' | 'prompting'

interface Waiter {
  method: string
  resolve: (v: Record<string, unknown>) => void
  reject: (e: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export interface AcpLive {
  /** 送一条用户消息。**同步返回**（照 `deliverMessage` 的既有形状：
   *  投递路上的失败经 `{k:'error'}` 异步通知，调用方不等） */
  deliver(message: string): void
  /** 会话中途改模型 / 强度。走 `session/set_config_option`，不重启、不丢上下文 */
  setParams(patch: { model?: string; effort?: string }): void
  /** 用户按了「停」。发 cancel、等响应、**进程留着**。
   *
   *  **返回「我有没有接手这一轮的收尾」**：
   *  `true`  —— cancel 已发出，`turn.done` 由这边在拿到 cancelled 响应时产出；
   *  `false` —— 这一刻根本没有在飞的轮次（最常见的是**进程已经死了**），
   *             调用方必须**自己补 `turn.done`**。
   *
   *  ⚠️ 这个返回值不是可有可无的。2026-09-03 用户实拍：omp 进程先死了，
   *  界面还停在「正在处理」，按停止毫无反应 —— 因为这里直接 return、
   *  而 `session.ts` 那侧只推了一条 `fatal:false` 的提醒。
   *  渲染层的 busy 有三支判据，**能一次放倒三支的只有 `turn.done`**
   *  （非 ACP 分支的注释里早写着，那边为此修过一次）。 */
  interrupt(): boolean
  /** 会话被关掉：发 `session/close`（不等），随后调用方照旧 kill */
  close(): void
  /** 渲染层点了审批卡片。不是这条路的 id 返回 false */
  resolveApproval(approvalId: unknown, decision: unknown): boolean
  /** 进程没了（外部 kill / 空闲回收 / 崩了）。幂等 */
  onProcessGone(): void
  /** 数据层要的会话累计。**是 `sessionStats()` 不是 `stats()`** —— 后者含花费，
   *  而花费已经经 `turn.done.costUsd` 进了 `tally`，两处都给就会被加两遍 */
  stats(): ReturnType<OmpTranslator['sessionStats']>
  /** 当前用的模型（服务端报的那个），会话层用它补 `session.ready` */
  model(): string | undefined
  phase(): Phase
}

export interface AcpLiveOptions {
  /** 卡片 id 前缀，会话层传 `<liveId>:` —— 两个 omp 会话的 toolCallId 可能撞，
   *  不加前缀会让它们在同一张全局表里互相顶掉 */
  idPrefix: string
  /** 会话建立后要下发的模型 / 强度。**在第一条 prompt 之前发**，
   *  否则用户选的模型一次都不会生效（`session/new` 收不了 model 参数） */
  model?: string
  effort?: string
  /** 恢复用的 ACP sessionId（= `SessionRecord.resumeId`） */
  resumeId?: string
  /** 拿到 sessionId 时回调，会话层据此写 `SessionRecord.resumeId` */
  onSessionId?(id: string): void
}

export function createAcpLive(deps: AcpDeps, cwd: string, opts: AcpLiveOptions): AcpLive {
  const approvals: AcpApprovals = createAcpApprovals()
  const decide = (ask: ApprovalAsk): Promise<ApprovalDecision> => approvals.decide(ask)
  // **翻译器只造一次，跨 restart 复用。**
  // 它的累计（花费、上下文分母）活在自己的闭包里；重建就归零，
  // 于是一个被空闲回收又唤醒的会话，团队面板同一行上 `tally.costUsd` 还是 $1.2、
  // 而 `stats` 变成空 —— 两个花费数字自相矛盾，还没人报错。
  const translator = createOmpTranslator(decide, cwd, { idPrefix: opts.idPrefix, now: deps.now })
  translator.onEvent((e) => deps.emit(e))

  let phase: Phase = 'dead'
  let proc: AcpProcess | null = null
  let sessionId = opts.resumeId
  let currentModel: string | undefined
  let buf = ''
  let stderrTail: string[] = []
  let nextId = 0
  let waiters = new Map<number, Waiter>()
  const queue: string[] = []
  /** 待下发的模型/强度。握手期改的排到这里，握手完与首次下发合并成一次 */
  let pendingParams: { model?: string; effort?: string } = {
    model: opts.model,
    effort: opts.effort
  }

  // ── 帧 ────────────────────────────────────────────────────────────────────

  function send(obj: Record<string, unknown>): void {
    if (!proc) return
    try {
      proc.write(JSON.stringify(obj) + '\n')
    } catch {
      // 进程可能正在退出。写失败不算致命 —— 与 `writeStdin` 的容错方式一致，
      // 真正的收尾由 exit 回调统一做
    }
  }

  function call(method: string, params: unknown, timeoutMs?: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!proc) return reject(new Error('omp 进程不在'))
      const id = nextId++
      const w: Waiter = { method, resolve, reject }
      if (timeoutMs) {
        w.timer = setTimeout(() => {
          if (waiters.delete(id)) reject(new Error(`${method} 超时（${timeoutMs}ms）`))
        }, timeoutMs)
        w.timer.unref?.()
      }
      waiters.set(id, w)
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  /** 通知：不带 id，不等回话 */
  function notify(method: string, params: unknown): void {
    send({ jsonrpc: '2.0', method, params })
  }

  function onLine(line: string): void {
    let m: Record<string, unknown>
    try {
      m = JSON.parse(line) as Record<string, unknown>
    } catch {
      return // 不是 JSON 就不是 ACP 的话。吞掉——翻译器的契约也是「绝不抛」
    }
    if (!m || typeof m !== 'object') return

    // ① 我们请求的响应
    if (m.method === undefined && m.id !== undefined) {
      const w = waiters.get(m.id as number)
      if (!w) return
      waiters.delete(m.id as number)
      if (w.timer) clearTimeout(w.timer)
      if (m.error) w.reject(rpcError(w.method, m.error))
      else w.resolve((m.result ?? {}) as Record<string, unknown>)
      return
    }

    // ② 服务端发来的通知 / 请求，交给翻译器
    const r = translator.push(line)
    for (const e of r.events) if (passes(e)) deps.emit(e)
    if (r.reply) {
      void Promise.resolve(r.reply).then((rep) => send({ jsonrpc: '2.0', id: rep.id, result: rep.result }))
    }

    // ③ 我们不认识的服务端**请求**必须回话，否则对方可能一直等。
    //    翻译器认识的那两条（审批双通道）已经在上面回了 reply。
    if (typeof m.method === 'string' && m.id !== undefined && !r.reply) {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `未实现：${m.method}` } })
    }
  }

  /** 握手期把「像是上一轮回放」的事件挡掉。
   *
   *  我们用的是 `session/resume`，上游实测**不重放**（`acp-agent.ts:731-740` 没有
   *  `#replaySessionHistory`，而 `loadSession` 有）。这道守卫是**兜底**：万一哪天换回
   *  load、或上游改了行为，没有它的症状是「每次续聊，整段历史被重新打一遍」，
   *  而且 `transcripts.notePartial` 会被历史文本刷掉。
   *
   *  **审批类一律放行**：那是要回话的，挡掉就挂死。 */
  function passes(e: ChatEvent): boolean {
    if (phase !== 'opening') return true
    return e.k === 'approval.request' || e.k === 'approval.resolved' || e.k === 'error'
  }

  function rpcError(method: string, err: unknown): Error {
    const o = (err ?? {}) as { message?: string; code?: number }
    return Object.assign(new Error(o.message || `${method} 失败`), { rpc: o })
  }

  // ── 起进程与握手 ──────────────────────────────────────────────────────────

  function open(): boolean {
    const got = deps.open(cwd)
    if (!got.ok) {
      deps.emit({ k: 'error', fatal: true, message: got.message, ...(got.setup ? { kind: 'setup' as const } : {}) })
      return false
    }
    const p = got.proc
    proc = p
    phase = 'opening'
    buf = ''
    stderrTail = []
    waiters = new Map()

    p.onLine((line) => onLine(line))
    p.onStderr((chunk) => {
      stderrTail.push(chunk)
      if (stderrTail.length > 40) stderrTail = stderrTail.slice(-40)
    })
    // **exit / error 只认闭包里自己这一个 `p`。**
    // 空闲回收 kill 之后会同步把 `live.proc` 清掉，而 exit 事件要之后才到；
    // 这个窗口里用户发一条消息就会起一个新进程 —— 旧进程的 exit 若操作「当前」引用，
    // 会把**新**进程的句柄清掉、把新的 rpc 关掉，于是新进程还活着却谁都杀不掉，
    // 成了孤儿（`session.ts:904-915` 那段注释描述的正是这类事故）。
    p.onExit((code, signal) => {
      if (proc !== p) return
      onGone(`omp 进程退出（code=${String(code)} signal=${String(signal)}）`)
    })
    return true
  }

  /** 进程没了：把在飞的请求全 reject、审批全 deny 落地、状态回 dead。**幂等**。 */
  function onGone(why: string): void {
    const wasPrompting = phase === 'prompting'
    proc = null
    phase = 'dead'
    for (const [, w] of waiters) {
      if (w.timer) clearTimeout(w.timer)
      w.reject(new Error(why))
    }
    waiters = new Map()
    // 两边都要叫：翻译器管事件（产 approval.resolved 清掉界面上的卡片），
    // 审批表管那些 Promise（不 settle 的话 reply 永远不 resolve）。各自幂等。
    translator.abort()
    approvals.abortAll()
    // prompt 在飞时进程没了 —— 那一轮不会有响应了，必须自己把 turn.done 补上，
    // 否则 `reduce.ts` 的 busy 三支判据一支都放不倒，界面一直转
    // （`session.ts:1215-1221` 的注释记着同一个坑）。
    if (wasPrompting) for (const e of translator.endTurn({ error: { message: why } })) deps.emit(e)
    deps.log(`[omp] ${why}`)
  }

  async function handshake(): Promise<void> {
    await call(
      'initialize',
      {
        protocolVersion: 1,
        clientInfo: { name: 'Eas-Term', version: deps.clientVersion },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          // **必须声明**：不声明的话 omp 直接拒掉需要问用户的工具，
          // 而不是「省掉第二条通道」（`ompEvents.ts` 文件头记着两条通道的关系）
          elicitation: { form: true }
        }
      },
      OPEN_TIMEOUT_MS
    )

    const mcpServers = deps.mcpServers()
    let res: Record<string, unknown>
    if (sessionId) {
      // **`session/resume` 不是 `session/load`。** 后者按协议要把整段历史以
      // `session/update` 重放一遍（上游 `acp-agent.ts:705` 显式调 `#replaySessionHistory`），
      // 我们的归约器会把旧轮次当新轮次再画一遍。resume 不重放（`:731-740`）。
      try {
        res = await call('session/resume', { sessionId, cwd, mcpServers }, OPEN_TIMEOUT_MS)
      } catch (e) {
        // 上游在内存与磁盘都找不到那个会话时直接抛（`acp-agent.ts:1258-1270`）。
        // 这时不能让会话卡死 —— 清掉 resumeId 重开一个，并**明说上下文丢了**：
        // 用户按停之后接着聊，最坏情况是那一轮没落盘，他有权知道。
        if (!/not found/i.test(String((e as Error).message))) throw e
        deps.emit({ k: 'error', fatal: false, message: '接不回上一段对话（它没能存下来），已经开了新的一段。' })
        sessionId = undefined
        res = await call('session/new', { cwd, mcpServers }, OPEN_TIMEOUT_MS)
      }
    } else {
      res = await call('session/new', { cwd, mcpServers }, OPEN_TIMEOUT_MS)
    }

    // **`session/resume` 的响应里没有 sessionId**（上游 `ResumeSessionResponse` 只有
    // configOptions 与 modes），只有 `session/new` 有 —— 所以 resume 那支沿用请求里那个。
    const gotId = typeof res.sessionId === 'string' ? res.sessionId : sessionId
    if (gotId && gotId !== sessionId) {
      sessionId = gotId
      opts.onSessionId?.(gotId)
    } else if (gotId) {
      opts.onSessionId?.(gotId)
    }

    const caps: AcpCapabilities = fromConfigOptions(res.configOptions)
    if (!caps.hasModel) {
      // **没配 provider 的唯一判据**（2026-09-02 在 18.1.2 上实测：没配时
      // configOptions 只有 mode 与 thinking 两项）。这里发 'setup' 而不是 'auth' ——
      // 'auth' 会让工具栏摆出「去登录」，那条路只认 claude/codex，点下去是死路。
      deps.emit({ k: 'error', fatal: true, kind: 'setup', message: '还没配好模型服务商。去设置里选一家 —— 用你已经买的订阅登录，或者填一把 API key，两条都行。' })
      throw new Error('omp 还没配 provider')
    }
    currentModel = caps.model
    deps.emit({ k: 'capabilities', models: caps.models, effortLevels: caps.effortLevels })

    phase = 'ready'
    if (sessionId) {
      deps.emit({ k: 'session.ready', sessionId, model: currentModel ?? '', cwd })
    }
    // 握手期排队的改动与首次下发合并成一次发出去（见 applyParams 的注释）
    await applyParams()
  }

  /** 把待下发的模型 / 强度真正发给服务端。
   *
   *  **必须在第一条 prompt 之前发**：`session/new` 的入参里根本没有 model
   *  （上游 `NewSessionRequest` 只有 cwd / mcpServers / additionalDirectories），
   *  spawn 也不带 `--model`（带了就要重启才能换模型，与「不重启改模型」冲突）。
   *  少这一步的症状很隐蔽：用户选了 A、实际跑的是服务端默认的 B，
   *  而工具栏显示的是回读的 currentValue —— 三处对不上，谁也看不出来。 */
  async function applyParams(): Promise<void> {
    const want = pendingParams
    pendingParams = {}
    if (!sessionId) return
    if (want.model && want.model !== currentModel) {
      await call('session/set_config_option', { sessionId, configId: 'model', value: want.model }, CONFIG_TIMEOUT_MS)
      currentModel = want.model
    }
    if (want.effort) {
      await call('session/set_config_option', { sessionId, configId: 'thinking', value: want.effort }, CONFIG_TIMEOUT_MS)
    }
  }

  // ── 送消息 ────────────────────────────────────────────────────────────────

  function pump(): void {
    if (phase !== 'ready' || queue.length === 0) return
    const next = queue.shift()
    if (next !== undefined) void prompt(next)
  }

  async function prompt(message: string): Promise<void> {
    phase = 'prompting'
    try {
      const res = await call('session/prompt', { sessionId, prompt: [{ type: 'text', text: message }] })
      for (const e of translator.endTurn({ result: res })) deps.emit(e)
    } catch (e) {
      // **JSON-RPC error 也是一轮的终点。** 配错 key / baseUrl 时最常见的就是这条路，
      // 不产 turn.done 的话界面永远停在「正在处理」。
      const err = e as Error & { rpc?: { code?: number; message?: string } }
      if (phase === 'prompting') for (const ev of translator.endTurn({ error: err.rpc ?? { message: err.message } })) deps.emit(ev)
    } finally {
      if (phase === 'prompting') phase = 'ready'
      pump()
    }
  }

  async function ensureAndSend(message: string): Promise<void> {
    queue.push(message)
    if (phase !== 'dead') return
    if (!open()) {
      queue.length = 0
      return
    }
    try {
      await handshake()
    } catch (e) {
      const msg = (e as Error).message || String(e)
      // 握手失败：把 stderr 尾巴带上 —— omp 自己的报错比我们编的准。
      // 「没配 provider」那支已经在 handshake 里发过一条更准的了，这里不重复发。
      if (!/还没配 provider/.test(msg)) {
        deps.emit({ k: 'error', fatal: true, message: `${msg}${tail()}` })
      }
      queue.length = 0
      onGone('握手失败')
      return
    }
    pump()
  }

  function tail(): string {
    const s = stderrTail.join('').trim()
    return s ? `\n${s.split('\n').slice(-8).join('\n')}` : ''
  }

  // ── 对外 ──────────────────────────────────────────────────────────────────

  return {
    deliver(message: string): void {
      void ensureAndSend(message)
    },

    setParams(patch): void {
      pendingParams = { ...pendingParams, ...patch }
      // 握手没完 / 正在跑一轮：先记着。握手完那一步会合并发出去；
      // 跑一轮时立刻发也可以（ACP 允许），但那会让「这一轮用的是哪个模型」
      // 变成时序问题 —— 记到下一轮之前发，语义更干净。
      if (phase !== 'ready') return
      void applyParams().catch((e) => {
        deps.emit({ k: 'error', fatal: false, message: `切换没生效：${(e as Error).message}` })
      })
    },

    interrupt(): boolean {
      // 没有在飞的轮次就**如实说没接手**，让调用方补 turn.done。
      // 进程已死（phase === 'dead'）走的正是这条 —— 那是用户撞到的那次。
      if (phase !== 'prompting' || !sessionId) return false
      // `session/cancel` 是**通知**（上游没有对应的响应），收到后它会立刻用
      // `stopReason:'cancelled'` 回掉在飞的那条 prompt。所以这里发完就等那条响应，
      // **不 kill 进程**：kill 会打断它后台那 5 秒的收尾，而收尾没做完的话
      // 下一条消息 `session/resume` 会以「找不到会话」失败 —— 用户看到的是
      // 「我只是停了一下，整段对话没了」，比 Claude 那边的表现还差一档。
      notify('session/cancel', { sessionId })
      const t = setTimeout(() => {
        if (phase !== 'prompting') return
        // 等不到就退回硬手段：这时 turn.done 由 onGone 补
        deps.log('[omp] cancel 之后没等到 prompt 响应，改为结束进程')
        proc?.kill()
      }, CANCEL_WAIT_MS)
      t.unref?.()
      return true
    },

    close(): void {
      if (sessionId && proc) notify('session/close', { sessionId })
    },

    resolveApproval(approvalId, decision): boolean {
      return approvals.resolve(approvalId, decision)
    },

    onProcessGone(): void {
      if (phase !== 'dead') onGone('omp 进程已结束')
    },

    stats: () => translator.sessionStats(),
    model: () => currentModel,
    phase: () => phase
  }
}
