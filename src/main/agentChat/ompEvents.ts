// oh-my-pi（omp）的 ACP 输出行 → ChatEvent。
//
// ⚠️ **这个文件目前不接进任何运行路径**，它是 2026-09-01 那次接入调研的第二步产物：
// 先把「翻译对不对」用真实录制的会话钉死，再谈要不要接。fixture 是真跑出来的
// （`__fixtures__/omp-acp-bash.jsonl`，omp 18.0.11 + 智谱 glm-5.3-flash，一条 bash 走完全程），
// 不是手写的。评估报告见 `docs/omp接入评估-2026-09-01.html`。
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
//   1. `session/request_permission` —— client-gated 的 bash/edit/delete/move 走这条，
//      载荷结构化（toolCall.title / kind / rawInput + 四个选项）
//   2. `elicitation/create` —— 通用审批走这条，形状是一个 JSON Schema 表单
//      （`{ value: enum[Approve, Deny] }`）。**只在客户端声明了 `elicitation.form` 能力时才发**
//
// 只答第 1 条，第 2 条没人理 → 整轮挂死。这是跑起来才知道的事，文档里没写。

import type { ChatEvent } from '../../shared/agentChat.ts'

/** 这一行要求我们往 stdin 回一个 JSON-RPC 响应。null = 不用回。 */
export interface AcpReply {
  /** 对应请求的 JSON-RPC id */
  id: number | string
  /** 直接就是 `result` 字段的值 */
  result: unknown
}

/**
 * 会话级的累计数据。**这是留给数据层的接口** —— 当前 UI 只消费其中一部分
 * （花费进 turn.done.costUsd，上下文占比进 Usage.contextRatio），
 * 但采集是全的，以后要做用量统计 / 成本看板不用回来改 translator。
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

export interface OmpTranslateResult {
  events: ChatEvent[]
  /** 要回给 agent 的响应（审批那两条通道）。**不回就会挂死**，见文件头 */
  reply: AcpReply | null
}

/** 审批时默认怎么回。真正接进 UI 时这里要换成「问用户」——
 *  留这个类型是为了让调用方显式表态，而不是让 translator 偷偷替用户点了同意。 */
export type ApprovalDecider = (req: {
  approvalId: string
  kind: 'exec' | 'patch' | 'tool'
  title: string
  detail: string
}) => 'allow' | 'deny'

export interface OmpTranslator {
  push(line: string): OmpTranslateResult
  /** 到此刻为止的会话级累计数据。见 OmpSessionStats —— **数据层的入口在这里**。 */
  stats(): OmpSessionStats
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

export function createOmpTranslator(decide: ApprovalDecider): OmpTranslator {
  /** 这一轮开始了没有。ACP **没有 turn_start 事件** —— 我们在收到第一条实质更新时
   *  自己合成一个，否则 reduce.ts 的 turnActive 永远不会置起，界面上「正在处理」不出现。 */
  let turnOpen = false
  /** 已经报过 exec.start 的 toolCallId。tool_call_update 只带 id 不带 title，
   *  要靠这张表把 done 和 start 配上。 */
  const execTitles = new Map<string, string>()
  /** usage_update 攒下来的会话级数据。**这个事件是轮末发的**
   *  （omp 的 #emitEndOfTurnUpdates），所以它到达时正好可以并进 turn.done。 */
  const acc: OmpSessionStats = {}

  const openTurn = (out: ChatEvent[]): void => {
    if (turnOpen) return
    turnOpen = true
    out.push({ k: 'turn.start' })
  }

  return {
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
        const approvalId = String(tc.toolCallId ?? m.id ?? '')
        const kind = approvalKind(tc.kind)
        const title = typeof tc.title === 'string' ? tc.title : ''
        const detail = detailOf(tc)
        openTurn(out)
        out.push({
          k: 'approval.request',
          approvalId,
          kind,
          title,
          detail,
          cwd: typeof p.sessionId === 'string' ? '' : ''
        })
        const d = decide({ approvalId, kind, title, detail })
        out.push({ k: 'approval.resolved', approvalId, decision: d })
        // 四个选项都实测见过：allow_once / allow_always / reject_once / reject_always。
        // **只用 *_once** —— *_always 会在 omp 那侧记住，等于我们替用户改了他的配置。
        return {
          events: out,
          reply: {
            id: m.id as number,
            result: {
              outcome: { outcome: 'selected', optionId: d === 'allow' ? 'allow_once' : 'reject_once' }
            }
          }
        }
      }

      if (m.method === 'elicitation/create') {
        // 第二条通道。它问的是同一件事，**不再重复产出 approval.request 事件** ——
        // 那样界面上一次 bash 会弹两张卡片。这里只负责回话。
        const p = (m.params ?? {}) as Record<string, unknown>
        const msg = typeof p.message === 'string' ? p.message : ''
        const d = decide({ approvalId: String(m.id ?? ''), kind: 'tool', title: '', detail: msg })
        return {
          events: [],
          reply: {
            id: m.id as number,
            result: { action: 'accept', content: { value: d === 'allow' ? 'Approve' : 'Deny' } }
          }
        }
      }

      if (m.method !== 'session/update') return { events: [], reply: null }

      const u = ((m.params as Record<string, unknown>)?.update ?? {}) as Record<string, unknown>
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': {
          const text = ((u.content ?? {}) as Record<string, unknown>).text
          if (typeof text === 'string' && text) {
            openTurn(out)
            out.push({ k: 'text.delta', text })
          }
          break
        }
        case 'agent_thought_chunk': {
          // 我们的 thinking 事件要的是 **token 数**，而 ACP 给的是文本增量。
          // 按 4 字符 ≈ 1 token 估 —— 这个数只用来在界面上显示「想了多久」，
          // 不参与计费也不参与任何判断，估算够用。**不要为此去接 tokenizer**。
          const text = ((u.content ?? {}) as Record<string, unknown>).text
          if (typeof text === 'string' && text) {
            openTurn(out)
            out.push({ k: 'thinking', tokens: Math.max(1, Math.round(text.length / 4)) })
          }
          break
        }
        case 'tool_call': {
          const id = String(u.toolCallId ?? '')
          const title = typeof u.title === 'string' ? u.title : ''
          execTitles.set(id, title)
          openTurn(out)
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
          break
        }
        // available_commands_update / session_info_update：纯元信息
        //（可用斜杠命令、时间戳），界面上没有对应的东西，丢掉。
        default:
          break
      }
      return { events: out, reply: null }
    },
    stats(): OmpSessionStats {
      return { ...acc }
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
 *  不是事件流的一部分，由发起方拿到 Promise 之后自己转。放这儿是为了让
 *  「怎么转」和事件翻译待在一起。 */
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
