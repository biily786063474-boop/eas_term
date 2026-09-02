// oh-my-pi（omp）的 ACP 输出行 → ChatEvent。
//
// fixture 是真跑出来的（`__fixtures__/omp-acp-bash.jsonl`，omp 18.0.11 + 智谱 glm-5.3-flash，
// 一条 bash 走完全程），不是手写的。评估报告见 `docs/omp接入评估-2026-09-01.html`，
// 接入设计见 `docs/superpowers/specs/2026-09-01-omp-底座接入-design.md` §六。
//
// ── 和 claude / codex 那两个 translator 最大的不同 ──────────────────────────
//
// 它们俩是**单向**的：进程往 stdout 吐行，我们只管解析。
// **ACP 是双向 JSON-RPC** —— agent 会主动向我们发请求并**等我们回话**，不回就整轮挂死
// （实测：不答 elicitation/create，`session/prompt` 干等到 180 秒超时）。
// 所以 push() 除了返回 ChatEvent，还要返回「这一行要求我们回什么」。
//
// ── 两条审批通道，缺一条就挂 ────────────────────────────────────────────────
//
// 实测 `tools.approvalMode: always-ask` 下，同一次 bash 调用 omp 会问**两遍**：
//
//   1. `session/request_permission` —— client-gated 的 bash/edit/delete/move 走这条
//      （上游 `session/acp-permission-gate.ts:8-13` 的 PERMISSION_REQUIRED_TOOLS 就这四个），
//      载荷结构化（toolCall.title / kind / rawInput + 四个选项）
//   2. `elicitation/create` —— 通用审批走这条，形状是一个 JSON Schema 表单
//      （`{ value: enum[Approve, Deny] }`）。**只在客户端声明了 `elicitation.form` 能力时才发**
//
// 只答第 1 条，第 2 条没人理 → 整轮挂死。这是跑起来才知道的事，文档里没写。
//
// ── 为什么两条只能靠「时序 + 文本」配对，不能靠 id ─────────────────────────
//
// `elicitation/create` 的 params 只有 `{mode, sessionId, message, requestedSchema}`
// （fixture 第 10 行；`modes/acp/acp-agent.ts:353-364` 的 unstable_createElicitation 调用），
// **没有 toolCallId**。而外层那条虽然在进程内部带着 `toolName`
// （`session/session-tools.ts:799-813` 传了），却在上线时被丢掉了
// —— `modes/acp/acp-client-bridge.ts:120-128` 组 ToolCallUpdate 时根本没抄 toolName。
// 两条报文之间**没有任何共同的 id 或工具名字段**，所以只剩「上一次决定 + 文本回配」这一条路。
//
// 配得上就复用上一次的决定（用户只看见一张卡片）；配不上就**单独弹一张卡**，
// 绝不「猜一个决定替用户点了」。`write` 这类工具不在上面那四个里，**只来 elicitation 一条**
// —— 那是常态，不是乱序。
//
// ── 完成判据是「决定已作出」，不是「两条都回」 ──────────────────────────────
//
// 拒绝之后内层压根不会执行：`session-tools.ts:837-839` 在 reject 分支直接 throw ToolError，
// 第二条通道再也不来。把「两条都回」当完成判据，界面上那张卡片会永远挂着。

import type { ChatEvent, SessionStats } from '../../shared/agentChat.ts'

/** 这一行要求我们往 stdin 回一个 JSON-RPC 响应。null = 不用回。 */
export interface AcpReply {
  /** 对应请求的 JSON-RPC id */
  id: number | string
  /** 直接就是 `result` 字段的值 */
  result: unknown
}

export type ApprovalDecision = 'allow' | 'deny'

/** 问用户「这个操作放不放行」时给出的全部信息。 */
export interface ApprovalAsk {
  /** 卡片的身份键，也是 `agentChat:resolveApproval` 回来时的键。三种形态见 `omp/approvals.ts` */
  approvalId: string
  /** 这条审批对应的 JSON-RPC 请求 id。**只用于排障日志** —— 回话用哪个 id 由本文件决定，
   *  不让决定器有机会写错一个 id 把整轮挂死 */
  rpcId: number | string
  kind: 'exec' | 'patch' | 'tool'
  title: string
  detail: string
}

/**
 * 审批时问谁。**真正接进 UI 时它是异步的**（要等用户点卡片，或等 5 分钟超时兜底），
 * 实现见 `omp/approvals.ts`。
 *
 * 返回值刻意收成「同步值 **或** Promise」的联合，而不是光收 Promise：
 * 既有的 24 条测试里有一堆同步决定器（`() => 'allow'`），它们钉的是与异步无关的翻译行为，
 * 为了改签名去动它们等于把「这些行为没变」这条证据也一起抹了。翻译器内部一律 `await`，
 * 所以同步返回只是少一次微任务，没有第二条代码路径。
 */
export type ApprovalDecider = (req: ApprovalAsk) => ApprovalDecision | Promise<ApprovalDecision>

export interface OmpTranslateResult {
  events: ChatEvent[]
  /** 要回给 agent 的响应（审批那两条通道）。**不回就会挂死**，见文件头。
   *  审批要等用户，所以多数时候是个 Promise —— 调用方 `await` 它再写 stdin。 */
  reply: AcpReply | Promise<AcpReply> | null
}

/**
 * 会话级的累计数据（翻译器内部这一份）。**比数据层那份多一个 `costUsd`**。
 *
 * `shared/agentChat.ts` 的 `SessionStats` 刻意没有 `costUsd`：花费已经有唯一出口
 * （`turn.done.costUsd` → `SessionRecord.tally`），两处都放同一个数迟早被加两遍。
 * 但 `turnDoneOf()` 要拿它去填那唯一的出口，所以翻译器自己必须攒着。
 * 两个出口因此分开：`stats()` 给 `turnDoneOf()`，`sessionStats()` 给 `SessionBrief.stats`。
 *
 * 全部字段可选，语义是「**没有**」而不是「0」：omp 只在 `cost > 0` 时才报花费，
 * 免费模型（或价格配成 0 的自定义 provider）永远拿不到这个字段。
 * 报成 0 会被界面读成「花了 $0」，那是错误信息不是「没有信息」
 * —— 这条规矩 codexEvents.ts 文件头写过，这里同一条。
 */
export interface OmpSessionStats {
  /** 累计花费（USD）。**累计不是单轮** —— 与 Claude 的 total_cost_usd 同语义，所以不会倒退 */
  costUsd?: number
  /** 上下文窗口大小（token）。omp 在 usage_update 里给 `size` */
  contextWindow?: number
  /** 已占用 token。omp 在 usage_update 里给 `used` */
  contextUsed?: number
}

/** `session/prompt` 这一轮怎么结束的。**两个分支都必须产 turn.done** ——
 *  JSON-RPC error 也是一轮的终点，不产的话 `busy` 三支判据放不倒，界面一直转。 */
export type TurnEnd =
  | { result: Record<string, unknown> }
  | { error: { code?: number; message?: string } }

export interface OmpTranslator {
  push(line: string): OmpTranslateResult
  /**
   * 延后产出的事件从这里出去（`approval.resolved` 只可能是延后的 —— 决定是等来的）。
   * 返回退订函数。
   */
  onEvent(cb: (e: ChatEvent) => void): () => void
  /** `session/prompt` 落地：收口正文、产 turn.done。error 分支多产一条非致命 error。 */
  endTurn(end: TurnEnd): ChatEvent[]
  /**
   * 这一轮被中断了（用户按停 / 进程退出 / restart）。
   *
   * **必须对每个还没 settle 的审批产 `approval.resolved{deny}`** ——
   * `reduce.ts:126` 的 pending 是单槽位，清它的**唯一入口**就是这个事件
   * （`:323`），不产的话中断之后卡片永远挂在界面上，而它对应的操作早就不会发生了。
   *
   * 未收口的正文缓冲**直接丢弃、不产 text.done**：那半句话是被打断的，
   * 把它当权威版本盖上去等于告诉用户「它说完了」。
   *
   * **它只管事件这一侧。** 那些审批的 Promise（决定器手里那个）要由调用方一并
   * `approvals.abortAll()` settle 掉，否则 reply 永远不 resolve。两边都是幂等的，
   * 谁先到都只产一次事件。
   */
  abort(): void
  /** 到此刻为止的累计数据，**含花费** —— 喂给 `turnDoneOf()`。 */
  stats(): OmpSessionStats
  /** 同上，但裁成数据层那份 `SessionStats`（**不含花费**，见 OmpSessionStats）。
   *  `SessionBrief.stats` 从这里取，不要直接给 `stats()`。 */
  sessionStats(): SessionStats
}

/** ACP 的 toolCall.kind → 我们的 approval kind。
 *
 *  实测 bash 报的是 `execute`。其余取值来自 ACP 规范，我**没有逐个跑出来**，
 *  所以认不出的一律落到 'tool' —— 宁可粒度粗一点，也不要把一个写操作误标成只读。 */
function approvalKind(acpKind: unknown): 'exec' | 'patch' | 'tool' {
  if (acpKind === 'execute') return 'exec'
  if (acpKind === 'edit' || acpKind === 'delete' || acpKind === 'move') return 'patch'
  return 'tool'
}

/** 从 toolCall 里取一行给人看的详情。优先用 rawInput（`{command:"ls"}` 这种），
 *  没有就退回 content 里的文本。两个都没有时返回空串，**不返回 undefined** ——
 *  ChatEvent 的 detail 是必填，给 undefined 会让下游渲染出字面的 "undefined"。 */
function detailOf(tc: Record<string, unknown>): string {
  const raw = tc.rawInput
  if (raw && typeof raw === 'object') {
    const cmd = (raw as Record<string, unknown>).command
    if (typeof cmd === 'string') return cmd
    try {
      return JSON.stringify(raw)
    } catch {
      /* 循环引用之类，退回下面那条路 */
    }
  }
  const content = tc.content
  if (Array.isArray(content)) {
    for (const c of content) {
      const t = (c as Record<string, unknown>)?.content as Record<string, unknown> | undefined
      if (t && typeof t.text === 'string') return t.text
    }
  }
  return ''
}

// ── 两条通道的回配 ─────────────────────────────────────────────────────────

/** 外层门控的那四个工具名。抄自上游 `session/acp-permission-gate.ts:8-13`
 *  的 `PERMISSION_REQUIRED_TOOLS`（13-矩阵的跨文件同步项）。
 *  内层 elicitation 报的工具名不在这四个里 → 它**不可能**是刚才那条外层审批的第二半。 */
const ACP_GATED_TOOLS = new Set(['bash', 'edit', 'delete', 'move'])

/** 上游 `tools/approval.ts:43` 的 DEFAULT_PROMPT_TRUNCATE_CHARS。
 *  长命令进 elicitation 的 message 时会被截到这个长度并接一条 `[…Nch elided…]`，
 *  所以回配要按「前 N 个字符对得上」算，不能要求整条相等。 */
const PROMPT_TRUNCATE_CHARS = 2000

/** 两条通道之间的最大间隔。omp 侧对同一次工具调用是严格串行的
 *  （外层 `session-tools.ts:817` 先 await requestPermission，通过后才执行，
 *  内层 `extensibility/extensions/wrapper.ts:331` 才发 elicitation），
 *  中间隔的只有一次工具启动，30 秒是很宽的余量。**过期就单独弹卡**，
 *  绝不拿一个陈年的决定去替用户放行一件新事。 */
const PAIR_WINDOW_MS = 30_000

/** 外层那条审批留下的槽，等内层 elicitation 来认领。**单槽** ——
 *  omp 对同一次工具调用严格串行，同一时刻不可能有两个「等着被内层复用」的决定。
 *
 *  **装的是 Promise 不是已定的值**，槽在 `request_permission` 到达时就**同步**建起来。
 *  换成「决定作出后才写槽」的话，就等于假设「内层一定在我们回话之后才到」——
 *  那是 omp 今天的实现（`session-tools.ts:817` 先 await 才执行），不是协议的承诺，
 *  而这个假设一旦不成立，症状是同一次 bash 弹两张卡、用户点两遍，
 *  没有任何报错能指向这里。装 Promise 则两种顺序都对。 */
export interface DecisionSlot {
  /** 外层那次审批的工具名。**只有 bash 推得出来** ——
   *  `session-tools.ts:804` 只在 `target.name === 'bash'` 时才往上线塞 `kind:'execute'`，
   *  其余三个（edit/delete/move）在报文里一个能认工具名的字段都没有。 */
  tool?: string
  /** 外层 rawInput 里的命令原文（bash 才有） */
  command?: string
  /** 计时起点。建槽时是「请求到达」，**决定作出的那一刻会重置一次** ——
   *  30 秒量的是「两条报文之间」，不该把用户盯着卡片发呆的那几分钟算进去。 */
  at: number
  decision: Promise<ApprovalDecision>
}

/** elicitation 的 message 首行固定是 `Allow tool: <name>`
 *  （上游 `tools/approval.ts:268` 的 formatApprovalPrompt）。拿不到就返回空串。 */
export function elicitationToolName(message: string): string {
  const first = message.split('\n', 1)[0] ?? ''
  const m = /^Allow tool:\s*(.+)$/.exec(first.trim())
  return m ? m[1].trim() : ''
}

/** message 里有没有 `Command:` 那一行（bash 的 formatApprovalDetails，`tools/bash.ts:580-584`）。
 *  **不取它的值**：命令可以是多行的，`Command: ` 之后的换行不会再带前缀，
 *  取值这件事做不干净；回配改成「命令原文出现在 message 里」，见 commandMatches。 */
function hasCommandLine(message: string): boolean {
  return message.split('\n').some((l) => l.startsWith('Command: '))
}

/** 外层那条命令的原文是否出现在内层的 message 里。 */
function commandMatches(message: string, command: string): boolean {
  if (command && message.includes(command)) return true
  // 被 truncateForPrompt 截过的长命令：只有前 2000 字符对得上
  return command.length > PROMPT_TRUNCATE_CHARS && message.includes(command.slice(0, PROMPT_TRUNCATE_CHARS))
}

/** 这条 elicitation 是不是刚才那条外层审批的第二半。**纯函数，钉在测试里**。 */
export function pairsWithSlot(slot: DecisionSlot | null, message: string, now: number): boolean {
  if (!slot) return false
  if (now - slot.at > PAIR_WINDOW_MS || now < slot.at) return false
  const name = elicitationToolName(message)
  if (!ACP_GATED_TOOLS.has(name)) return false
  if (slot.tool) {
    if (slot.tool !== name) return false
  } else if (name === 'bash') {
    // 槽里没记 tool = 外层不是 bash（只有 bash 带 kind），那内层就不该是 bash
    return false
  }
  if (slot.command !== undefined) return commandMatches(message, slot.command)
  // 外层不是 bash 却来了带 Command 的 elicitation —— 两件不同的事，不配
  return !hasCommandLine(message)
}

export interface OmpTranslatorOptions {
  /** 卡片 id 的前缀，会话层传 `<liveId>:`。见 `omp/approvals.ts` 的三种形态 */
  idPrefix?: string
  /** 取当前时间。**只为让回配窗口能在测试里被拨动**，生产用 Date.now */
  now?: () => number
}

export function createOmpTranslator(
  decide: ApprovalDecider,
  /** 这个会话在哪个目录跑。进 `approval.request.cwd` —— 卡片上「在哪跑」那一行。 */
  cwd = '',
  opts: OmpTranslatorOptions = {}
): OmpTranslator {
  const idPrefix = opts.idPrefix ?? ''
  const now = opts.now ?? Date.now
  /** 已经报过 exec.start 的 toolCallId。tool_call_update 只带 id 不带 title，
   *  要靠这张表把 done 和 start 配上。 */
  const execTitles = new Map<string, string>()
  /** usage_update 攒下来的会话级数据。**这个事件是轮末发的**
   *  （omp 的 #emitEndOfTurnUpdates），所以它到达时正好可以并进 turn.done。 */
  const acc: OmpSessionStats = {}
  /** 币种单独放，不进 acc —— acc 是喂 turnDoneOf 的那份，形状不该被展示字段撑大 */
  let currency: string | undefined
  const listeners = new Set<(e: ChatEvent) => void>()
  /** 本翻译器已经产过 approval.request、还没产 approval.resolved 的卡片。
   *  **这张表是「事件产没产」的账**，与 `omp/approvals.ts` 那张「Promise settle 没 settle」
   *  的账是两本，故意分开：中断时两边各自幂等地收自己那本，谁先到都只产一次事件。 */
  const openApprovals = new Set<string>()
  let slot: DecisionSlot | null = null
  /** 正文缓冲与它的 messageId。**收口只认 agent_message_chunk 的 messageId** ——
   *  思考流是另一个 messageId（fixture 5-7 行 vs 14-21 行），
   *  按「来了别的更新就收口」会在一次 bash 中间把半句话当成完整回答盖上去。 */
  let textBuf = ''
  let textMsgId: string | null = null

  const emit = (e: ChatEvent): void => {
    for (const cb of listeners) cb(e)
  }

  /** 产 approval.resolved，且**只产一次**。用户点击 / 超时兜底 / abort 都走这里。 */
  const settle = (approvalId: string, decision: ApprovalDecision): boolean => {
    if (!openApprovals.delete(approvalId)) return false
    emit({ k: 'approval.resolved', approvalId, decision })
    return true
  }

  /** 收口正文。**只有真攒到字才产 text.done** —— 空气泡是噪音不是信息
   *  （与 claudeEvents.ts:214-219 / codexEvents.ts:100 同一条规矩）。 */
  const flushText = (out: ChatEvent[]): void => {
    if (textBuf) out.push({ k: 'text.done', text: textBuf })
    textBuf = ''
    textMsgId = null
  }

  const ask = (
    approvalId: string,
    rpcId: number | string,
    kind: 'exec' | 'patch' | 'tool',
    title: string,
    detail: string,
    out: ChatEvent[]
  ): Promise<ApprovalDecision> => {
    openApprovals.add(approvalId)
    out.push({ k: 'approval.request', approvalId, kind, title, detail, cwd })
    // **同步调决定器**，不裹一层 `Promise.resolve().then(…)`：那样卡片会晚一个微任务
    // 才进待决表，而 abort() 可能就发生在这个缝里 —— 表里于是多出一个谁都不会 settle
    // 的条目，reply 永远不写回去。同步调就没有这个缝，代价只是要自己 try 一下。
    let p: Promise<ApprovalDecision>
    try {
      p = Promise.resolve(decide({ approvalId, rpcId, kind, title, detail }))
    } catch {
      // 决定器抛了也不能让整轮挂死：兜底 deny，和超时同一个方向（宁可少做一件事）
      p = Promise.resolve('deny')
    }
    return p
      .then(
        (d) => (d === 'allow' ? 'allow' : 'deny'),
        () => 'deny' as const
      )
      .then((d) => {
        settle(approvalId, d)
        return d
      })
  }

  return {
    onEvent(cb: (e: ChatEvent) => void): () => void {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },

    push(line: string): OmpTranslateResult {
      const out: ChatEvent[] = []
      let m: Record<string, unknown>
      // 解析失败一律吞掉 —— CliAdapter 的 ChatEventTranslator 契约明写「绝不抛」。
      // ACP 进程的 stderr 也可能混进来，那不是 JSON。
      try {
        m = JSON.parse(line) as Record<string, unknown>
      } catch {
        return { events: [], reply: null }
      }
      if (!m || typeof m !== 'object') return { events: [], reply: null }

      // ── agent 主动请求：审批。两条通道都要答，见文件头 ────────────────
      if (m.method === 'session/request_permission') {
        const p = (m.params ?? {}) as Record<string, unknown>
        const tc = (p.toolCall ?? {}) as Record<string, unknown>
        const rpcId = (m.id ?? '') as number | string
        const tcid = typeof tc.toolCallId === 'string' ? tc.toolCallId : ''
        // toolCallId 缺席时退回 rpc id：卡片总得有个身份键，
        // 而 JSON-RPC id 在一条连接里本来就是唯一的
        const approvalId = `${idPrefix}${tcid || `rpc-${String(rpcId)}`}`
        const kind = approvalKind(tc.kind)
        const title = typeof tc.title === 'string' ? tc.title : ''
        const detail = detailOf(tc)
        const raw = (tc.rawInput ?? {}) as Record<string, unknown>
        const command = typeof raw.command === 'string' ? raw.command : undefined
        const decision = ask(approvalId, rpcId, kind, title, detail, out)
        // 同步建槽，等内层来认领（见 DecisionSlot 上那段：不假设谁先到）
        const entry: DecisionSlot = {
          tool: tc.kind === 'execute' ? 'bash' : undefined,
          command,
          at: now(),
          decision
        }
        slot = entry
        void decision.then(() => {
          entry.at = now()
        })
        return {
          events: out,
          reply: decision.then((d) => ({
            id: rpcId,
            // 四个选项都实测见过：allow_once / allow_always / reject_once / reject_always。
            // **只用 *_once** —— *_always 会在 omp 那侧记住（`session-tools.ts:832-836`
            // 写进 #acpPermissionDecisions），等于我们替用户改了他的配置。
            result: {
              outcome: { outcome: 'selected', optionId: d === 'allow' ? 'allow_once' : 'reject_once' }
            }
          }))
        }
      }

      if (m.method === 'elicitation/create') {
        const p = (m.params ?? {}) as Record<string, unknown>
        const msg = typeof p.message === 'string' ? p.message : ''
        const rpcId = (m.id ?? '') as number | string
        const answer = (d: ApprovalDecision): AcpReply => ({
          id: rpcId,
          result: { action: 'accept', content: { value: d === 'allow' ? 'Approve' : 'Deny' } }
        })
        if (slot && pairsWithSlot(slot, msg, now())) {
          // 同一件事的第二半：复用外层那个决定，**不再产 approval.request** ——
          // 那样界面上一次 bash 会弹两张卡片。槽用完就清，一个决定只放行一次。
          const d = slot.decision
          slot = null
          return { events: [], reply: d.then(answer) }
        }
        // 配不上（`write` 这类只走内层的工具是常态）→ 单独弹一张卡，问用户。
        // **绝不因为「刚才批过一个」就替他点了。**
        const approvalId = `${idPrefix}elic-${String(rpcId)}`
        const title = msg.split('\n', 1)[0] ?? ''
        return { events: out, reply: ask(approvalId, rpcId, 'tool', title, msg, out).then(answer) }
      }

      if (m.method !== 'session/update') return { events: [], reply: null }

      const u = ((m.params as Record<string, unknown>)?.update ?? {}) as Record<string, unknown>
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': {
          const text = ((u.content ?? {}) as Record<string, unknown>).text
          if (typeof text === 'string' && text) {
            const mid = typeof u.messageId === 'string' ? u.messageId : ''
            // 换了一条 message = 上一条说完了。**收口的唯一判据就是它**
            if (textMsgId !== null && mid !== textMsgId) flushText(out)
            textMsgId = mid
            textBuf += text
            out.push({ k: 'text.delta', text })
          }
          break
        }
        case 'agent_thought_chunk': {
          // 我们的 thinking 事件要的是 **token 数**，而 ACP 给的是文本增量。
          // 按 4 字符 ≈ 1 token 估 —— 这个数只用来在界面上显示「想了多久」，
          // 不参与计费也不参与任何判断，估算够用。**不要为此去接 tokenizer**。
          // 它的 messageId 是另一条，**不参与正文收口**（见 textMsgId 那条注释）。
          const text = ((u.content ?? {}) as Record<string, unknown>).text
          if (typeof text === 'string' && text) {
            out.push({ k: 'thinking', tokens: Math.max(1, Math.round(text.length / 4)) })
          }
          break
        }
        case 'tool_call': {
          const id = String(u.toolCallId ?? '')
          const title = typeof u.title === 'string' ? u.title : ''
          execTitles.set(id, title)
          out.push({ k: 'exec.start', execId: id, label: title, detail: detailOf(u) })
          break
        }
        case 'tool_call_update': {
          const id = String(u.toolCallId ?? '')
          const status = u.status
          // **只有终态才产出 exec.done。** in_progress 会来好几次（实测一次 bash 来了两条），
          // 每条都当完成的话，界面上那张卡片会反复在「跑着」和「跑完」之间跳。
          if (status !== 'completed' && status !== 'failed') break
          out.push({
            k: 'exec.done',
            execId: id,
            ok: status === 'completed',
            output: detailOf(u)
          })
          execTitles.delete(id)
          break
        }
        case 'usage_update': {
          // **这个事件比它的名字重要得多**，一度被我整个丢掉过。它装着三样：
          //   size —— 上下文窗口（**分母**）
          //   used —— 已占用 token（分子）
          //   cost —— 会话累计花费 { amount, currency }，omp 只在 > 0 时才带
          //
          // 丢掉的理由当时写的是「那是上下文占用不是计费」—— **说反了，两样都在里面**。
          // 而且 Usage.contextRatio 的规矩是「拿不到分母时不填」，omp 恰恰给了分母，
          // 所以这里填出来的比例是**算出来的不是猜的**。
          // 不产出事件：我们的 ChatEvent 没有轮中用量这一档，攒着并进 turn.done。
          if (typeof u.size === 'number' && u.size > 0) acc.contextWindow = u.size
          if (typeof u.used === 'number') acc.contextUsed = u.used
          const c = u.cost as Record<string, unknown> | undefined
          if (c && typeof c.amount === 'number') acc.costUsd = c.amount
          // 币种原样收着，不假定美元（上游今天恒为 'USD'，`acp-agent.ts:2150-2159`，
          // 但那是它的实现细节不是协议承诺）
          if (c && typeof c.currency === 'string' && c.currency) currency = c.currency
          break
        }
        // available_commands_update / session_info_update：纯元信息
        //（可用斜杠命令、时间戳），界面上没有对应的东西，丢掉。
        // resume 之后 50ms 这两条必到（omp 的 #scheduleBootstrapUpdates），
        // 更不能让它们产出任何东西。
        default:
          break
      }
      return { events: out, reply: null }
    },

    endTurn(end: TurnEnd): ChatEvent[] {
      const out: ChatEvent[] = []
      flushText(out)
      if ('error' in end) {
        // prompt 回了 JSON-RPC error：这一轮**也结束了**。
        // 只推 error 不推 turn.done，`busy` 放不倒，界面会一直转。
        const msg = end.error?.message
        out.push({
          k: 'error',
          fatal: false,
          message: typeof msg === 'string' && msg ? msg : 'omp 这一轮失败了（没给原因）'
        })
        out.push(turnDoneOf({}, acc))
      } else {
        out.push(turnDoneOf(end.result ?? {}, acc))
      }
      return out
    },

    abort(): void {
      // 被打断的半句话不收口 —— 见接口上的注释
      textBuf = ''
      textMsgId = null
      slot = null
      for (const id of [...openApprovals]) settle(id, 'deny')
    },

    stats(): OmpSessionStats {
      return { ...acc }
    },

    sessionStats(): SessionStats {
      const s: SessionStats = {}
      if (acc.contextWindow !== undefined) s.contextWindow = acc.contextWindow
      if (acc.contextUsed !== undefined) s.contextUsed = acc.contextUsed
      if (currency !== undefined) s.currency = currency
      return s
    }
  }
}

/** `session/prompt` 的响应 → turn.done。
 *
 *  **要两份数据才拼得全**：
 *   · promptResult.usage —— **本轮**的 token 增量（omp 的 #buildTurnUsage 算的 current − previous）
 *   · translator.stats() —— **会话累计**的花费与上下文占用（从 usage_update 攒的）
 *
 *  **不在 push() 里做**：prompt 的响应是一个请求的回值（带我们自己发的 id），
 *  不是事件流的一部分，由发起方拿到 Promise 之后自己转（`endTurn()` 就是那条路）。
 *  放这儿是为了让「怎么转」和事件翻译待在一起。 */
export function turnDoneOf(
  promptResult: Record<string, unknown>,
  stats: OmpSessionStats = {}
): Extract<ChatEvent, { k: 'turn.done' }> {
  const usage = (promptResult?.usage ?? {}) as Record<string, number>
  // 分母拿得到才填比例 —— 这条原则一个字没改，只是 omp 恰好给了分母
  const ratio =
    stats.contextWindow && stats.contextWindow > 0 && typeof stats.contextUsed === 'number'
      ? Math.min(1, stats.contextUsed / stats.contextWindow)
      : undefined
  return {
    k: 'turn.done',
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      // omp 报 cachedReadTokens（实测见过 10944），我们的字段叫 cachedInputTokens
      cachedInputTokens: usage.cachedReadTokens ?? 0,
      contextRatio: ratio
    },
    // **缺就是缺，不补 0。** omp 只在 cost > 0 时报 —— 免费模型永远没有这个字段，
    // 显示「花了 $0」是错的信息，不是「没有信息」（同 codexEvents 文件头那条）
    costUsd: stats.costUsd
  }
}

// ── session/new 与 session/resume 的 configOptions ─────────────────────────

export interface AcpCapabilities {
  /** 有没有 `model` 那一项。**没有 = 这个 omp 还没配 provider** ——
   *  2026-09-02 实测：没配 provider 时 configOptions 只有 mode 与 thinking 两项。
   *  这是「要引导用户去配」的**唯一判据**，不要去猜别的字段。 */
  hasModel: boolean
  models?: { id: string; label: string }[]
  effortLevels?: { id: string; label: string }[]
  /** 服务端当前选中的值（`<provider>/<model>`）。session.ready 的 model 用它 */
  model?: string
  thinking?: string
}

/** `session/new` / `session/resume` 响应里的 `configOptions` → 能力清单。
 *
 *  **它是数组不是对象**（fixture 第 2 行：`[{id:'mode'…},{id:'model'…},{id:'thinking'…}]`），
 *  取项一律 `find(o => o.id === …)`。`id === 'mode'`（default / plan）**显式忽略**：
 *  那是 omp 的运行模式，与我们工具栏上的「模型 / 强度」不是一回事，
 *  混进 models 会让下拉里冒出两个没人认识的选项。 */
export function fromConfigOptions(configOptions: unknown): AcpCapabilities {
  const list = Array.isArray(configOptions) ? (configOptions as Record<string, unknown>[]) : []
  const pick = (id: string): Record<string, unknown> | undefined =>
    list.find((o) => o && typeof o === 'object' && o.id === id)
  const items = (o: Record<string, unknown> | undefined): { id: string; label: string }[] | undefined => {
    if (!o || !Array.isArray(o.options)) return undefined
    const out: { id: string; label: string }[] = []
    for (const raw of o.options as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue
      const value = raw.value
      if (typeof value !== 'string' || !value) continue
      out.push({ id: value, label: typeof raw.name === 'string' && raw.name ? raw.name : value })
    }
    return out
  }
  const model = pick('model')
  const thinking = pick('thinking')
  const cur = (o: Record<string, unknown> | undefined): string | undefined =>
    o && typeof o.currentValue === 'string' && o.currentValue ? o.currentValue : undefined
  const caps: AcpCapabilities = { hasModel: !!model }
  const models = items(model)
  if (models && models.length) caps.models = models
  const effortLevels = items(thinking)
  if (effortLevels && effortLevels.length) caps.effortLevels = effortLevels
  const m = cur(model)
  if (m) caps.model = m
  const t = cur(thinking)
  if (t) caps.thinking = t
  return caps
}
