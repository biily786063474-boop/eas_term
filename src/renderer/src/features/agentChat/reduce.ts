// 事件归约器：把内核送来的 ChatEvent 流，累积成界面直接能渲染的 ChatView。
// **纯逻辑，不引 React / DOM。** 有状态（一次会话内的轮次要累积），所以是工厂函数
// 返回 { push, view }，不是纯函数——但状态只活在闭包里，上层组件只管把事件喂进来、
// 把 view() 的结果渲染出来，不再摸原始事件。后面所有 UI 组件的正确性都靠这一层保证。
//
// 三条硬约束（背后是实测教训，不是设计偏好，改这个文件前先看 task-1-brief.md）：
// ① 失败项常驻可见——visibleExecs 折叠时也不能把失败项挤出三行窗口。实测过模型在
//    Write 被拒之后仍说「已创建完成」，失败被埋掉，用户看到的就是一句谎话加一片安静。
// ② error 事件一条都不能丢，全部进 notices（不分 fatal）——这是「hook 装不上时告知
//    而非阻断」这条裁定的全部说服力所在，归约器丢了它，界面就没得显示。
// ③ text.delta 现在**有**生产者了（claudeEvents 的 stream_event 分支，2026-08-17）。
//    它跟 text.done 讲的是同一段话：delta 一个字一个字来，done 最后给完整版。
//    所以 done 必须**覆盖** delta 攒出来的那个轮次，不能再 push 一个——否则同一段话
//    在界面上出现两次。这是这个文件里最容易改错的一条。

import type { ChatEvent, Usage } from '../../../../shared/agentChat.ts'

export interface ExecItem {
  execId: string
  label: string
  detail: string
  state: 'running' | 'ok' | 'failed'
  output?: string
}

export interface Turn {
  role: 'user' | 'assistant'
  text: string
  execs: ExecItem[]
  /**
   * **这条不是对话，是一条分隔标记**：「上下文在这里被压缩了」。
   *
   * 没有做成第三种 role，是因为 role 那个联合类型被界面各处的
   * `role === 'user'` / `=== 'assistant'` 分支读着，加一个成员会让每处都多出
   * 一条「两边都不是」的死分支，而它们的默认行为是渲染成一个空气泡。
   * 用一个可选字段 + 渲染时提前返回，改动面小得多，语义也更直白：
   * **它不是谁说的话，它是时间轴上的一道线。**
   */
  compact?: {
    /** null = 不知道是自动还是手动（stream 里多数时候不带这个信息） */
    trigger: 'auto' | 'manual' | null
    preTokens: number
    postTokens: number
    /** 这一刀砍掉了界面上多少轮 */
    droppedTurns: number
  }
  /** 这条消息带的图。**只有用户轮次会有** —— 归约器从不产出它（它连 user 轮次都不产出，
   *  见文件头），是渲染层合并用户消息时带进来的。
   *  发给 CLI 的始终是磁盘路径（agent 认那个），这里存的是缩略图，只为界面预览。 */
  images?: { path: string; url: string }[]
}

export interface ApprovalPending {
  approvalId: string
  kind: 'exec' | 'patch' | 'tool'
  title: string
  detail: string
  cwd: string
}

export interface Notice {
  id: string
  text: string
  fatal: boolean
  /** 这条 notice 一模一样地发生过几次。**去重不是丢弃**：Claude 每次 restart 都会重推
   *  同一条（拒绝装 hook / hook 装不上），Codex 每条消息一个新进程、退出码非零就再推一条
   *  同样的 fatal——修复前这些会一条条堆进工具栏，而工具栏是 flex-shrink:0、对话区是
   *  flex:1;min-height:0，notices 涨多少对话区就被挤掉多少（2026-08-17 全分支最终评审
   *  I5：在画布上一个 300px 高的节点里，七八条就基本看不见对话了）。
   *  合并成一条 + 计数，既守住"{k:'error',fatal:false} 必须显示"这条硬约束，
   *  又不让重复内容占版面。 */
  count: number
  /** 错误类别，原样来自事件（见 shared/agentChat.ts 的 ChatEvent）。
   *  'auth' 那条界面上要摆登录入口，不是只显示一行字。
   *  **界面按这个分支，不要去匹配 text 里的中文。** */
  kind?: 'auth'
}

/** notices 数组的条数上限。**版面不被挤掉这件事已经由 CSS 负责**（.ac-notices 有
 *  max-height + overflow-y:auto），这个上限纯粹是内存与列表长度的兜底：去重之后
 *  真正"互不相同"的 notice 极难攒到这个数（两个高频重复源都会被折叠成一条）。
 *  满了丢最旧的一条。 */
export const MAX_NOTICES = 8

/**
 * 内存里最多留多少轮。**这道闸之前是敞开的** —— 落盘那侧早就有 MAX_TURNS=40
 * （history.ts），但内存里一条都不丢，一个跑了一天的对话节点会把整场对话
 * 连同每一条命令的完整输出全揣在内存里。
 *
 * 取 60 而不是 40：**显示的必须不少于存下来的**，否则「重开之后反而看到更多」
 * 会显得像个 bug。留 20 轮余量，重开前后看到的内容是连续的。
 */
export const MAX_LIVE_TURNS = 60

/**
 * 内存里单条命令输出留多少字符。落盘那侧是 1200（只为回看「跑过什么、成没成」），
 * 内存这侧宽松得多 —— 界面上那个展开框是真要给人读的。
 *
 * 但不能无上限：一次 `npm test` 或一次 build 的输出几十万字，**事件源头一处都没截**
 * （claudeEvents 那两个 slice 截的是命令的**标签**，不是输出）。
 * 20000 字约等于 300 行，超出这个量的日志没人会在气泡里读完，该去终端重跑。
 */
export const MAX_LIVE_OUTPUT = 20_000

/** 订阅额度窗口的现状。**没有「用了百分之多少」** —— CLI 那条事件里就没有这个字段
 *  （实测样本见 shared/agentChat.ts 的 quota 事件说明）。所以界面只报窗口和重置时间，
 *  不编进度百分比。 */
export interface Quota {
  window: string
  status: string
  resetsAt?: number
  /** 已用比例 0~1。**不是每个窗口都有**（实测五小时没带、七天带了），
   *  拿不到就别显示进度——同 contextRatio 那条原则 */
  utilization?: number
}

export interface ChatView {
  /** CLI **自己报告**的当前模型（session.ready 带的那个）。
   *  发 /model 切换之后 CLI 会重推一次 init，这个值跟着变 —— 所以界面显示的是
   *  「它实际在用什么」，不是「我们以为选了什么」。拿不到就是 null（别猜）。 */
  model: string | null
  /** 各个额度窗口的最新状态，按 window 去重（五小时和周是两条，各自更新）。
   *  空数组 = 这个 CLI 没报过额度（Codex 就不报） */
  quotas: Quota[]
  turns: Turn[]
  pending: ApprovalPending | null
  notices: Notice[]
  usage: Usage | null
  costUsd?: number
  busy: boolean
}

export function createChatReducer(): { push(e: ChatEvent): void; view(): ChatView } {
  const turns: Turn[] = []
  const notices: Notice[] = []
  let pending: ApprovalPending | null = null
  let usage: Usage | null = null
  let costUsd: number | undefined
  let noticeSeq = 0
  // busy 的第二支：「收到过 exec.start 但还没 turn.done」。独立于「execs 里还有没有
  // running 项」，是因为一个 exec 全部跑完之后、turn.done 到达之前，agent 仍可能继续
  // 说话或再发起下一个 exec——这段真空期界面也该显示忙碌，不能因为暂时没有 running
  // 项就提前收起 spinner。
  let sawExecStartSinceTurnDone = false
  /** 「这一轮开始了、还没结束」。**turn.start 起，turn.done 止。**
   *
   *  它补的是 busy 原来漏掉的那一段。实测（2026-08-17 探针，真跑 Claude）：
   *    3ms 消息投递 → 2523ms session.ready → **6814ms 第一个 text.delta**
   *  中间 4 秒多既没有 running 的 exec、也没收到过 exec.start，busy 两支判据都不成立，
   *  界面上的「处理中…」消失后彻底静止 —— 用户报的断档就是这一段。
   *
   *  **起点一度是 session.ready，那是错的**：那个事件只在起会话/restart 时才有，
   *  普通 send 不产生它 —— 于是第二条消息之后 turnActive 永远为假，同一个洞换个
   *  地方复现。现在由会话层在投递消息时推的 turn.start 驱动，每一轮都精确。 */
  let turnActive = false
  let model: string | null = null
  const quotas: Quota[] = []
  /** 正在流式接收的那个轮次。**同一段文字会来两遍** —— 先是若干 text.delta 增量，
   *  最后 assistant 事件再给一份完整的 text.done。留着这个引用，done 到达时才知道
   *  该「覆盖刚才攒的那个轮次」而不是「再 push 一个新轮次」（否则同一段话显示两次）。 */
  let streamingTurn: Turn | null = null

  /** exec.start 要挂到的轮次：有就用当前最后一个（本归约器只产出 assistant 轮次，
   *  所以「最后一个」必然是 assistant，不需要额外查 role）；没有就先造一个空文本的。 */
  function ensureAssistantTurn(): Turn {
    const last = turns[turns.length - 1]
    if (last) return last
    const created: Turn = { role: 'assistant', text: '', execs: [] }
    turns.push(created)
    return created
  }

  /**
   * 内存裁剪。**只从头上砍，末尾一律不动。**
   *
   * 为什么这样就够：`streamingTurn` 和还在 running 的 exec **只可能落在最新那一轮**
   * —— 流式轮次每轮结束时清空，running 的 exec 也在 turn.done 那里被收成 failed
   * （见那个 case 里为「中断」写的那段）。而从头上砍、保留末尾 MAX_LIVE_TURNS 轮，
   * 最新那一轮永远在保留区里。
   *
   * 下面那两个判断因此是**冗余的防护**，不是当前会触发的分支：留着是因为
   * `exec.done` 按 execId 在全部 turns 里找，哪天有人把裁剪改激进了（比如按字节砍、
   * 或者从中间砍），被砍掉的轮次会让结果落不回去，界面上留一个永远转不完的圈 ——
   * 那种 bug 极难查。**代价是两次数组扫描，值。**
   */
  function trimTurns(): void {
    if (turns.length <= MAX_LIVE_TURNS) return
    let drop = turns.length - MAX_LIVE_TURNS
    let i = 0
    while (i < drop) {
      const t = turns[i]
      if (t === streamingTurn || t.execs.some((x) => x.state === 'running')) break
      i++
    }
    if (i > 0) turns.splice(0, i)
  }

  function push(e: ChatEvent): void {
    // **每轮结束时收一次内存。** 挂在 turn.done 而不是每次 push：
    // 那一刻既没有流式轮次、running exec 也多半收完了，砍得最干净；
    // 而且一轮里可能有几十个 text.delta，每个都跑一遍裁剪纯属浪费。
    if (e.k === 'turn.done') trimTurns()
    // 一轮开始。放在 switch 之前而不是加一个 case：它只是给 turnActive 打个标，
    // 不产生任何视图内容，走 default 忽略仍然是对的。
    if (e.k === 'turn.start') turnActive = true
    // CLI 报的当前模型。/model 切换后它会重推 init，这里跟着更新 —— 不自己记选择。
    if (e.k === 'session.ready' && e.model) model = e.model
    // 额度：同一个窗口只留最新一条（就地更新，不堆历史——界面只关心"现在怎么样"）
    if (e.k === 'quota') {
      const i = quotas.findIndex((q) => q.window === e.window)
      const next = {
        window: e.window,
        status: e.status,
        resetsAt: e.resetsAt,
        utilization: e.utilization
      }
      if (i >= 0) quotas[i] = next
      else quotas.push(next)
    }
    switch (e.k) {
      case 'text.delta': {
        // 流式增量：攒进当前正在流的轮次，没有就开一个。
        // 空串在翻译器那层就被挡掉了，这里到达的一定有内容。
        if (!streamingTurn) {
          streamingTurn = { role: 'assistant', text: '', execs: [] }
          turns.push(streamingTurn)
        }
        streamingTurn.text += e.text
        break
      }
      case 'text.done': {
        // **同一段文字 delta 已经攒过一遍**（带 --include-partial-messages 时），
        // 这里要覆盖那个轮次，不能再 push —— 否则用户看到同一段话出现两次。
        // 覆盖而不是「保留 delta 攒的」：done 是权威版本，delta 可能因为丢包/截断不全。
        // execs 留着：工具调用可能在文字中间挂到了这个轮次上。
        if (streamingTurn) {
          streamingTurn.text = e.text
          streamingTurn = null
        } else {
          turns.push({ role: 'assistant', text: e.text, execs: [] })
        }
        break
      }
      case 'exec.start': {
        const turn = ensureAssistantTurn()
        turn.execs.push({ execId: e.execId, label: e.label, detail: e.detail, state: 'running' })
        sawExecStartSinceTurnDone = true
        break
      }
      case 'exec.done': {
        // 按 execId 全局查找（不只查最后一个轮次）——找不到就忽略，不抛。
        let item: ExecItem | undefined
        for (const t of turns) {
          item = t.execs.find((x) => x.execId === e.execId)
          if (item) break
        }
        if (!item) break
        item.state = e.ok ? 'ok' : 'failed'
        // **进内存就截。** 源头一处都没截（见 MAX_LIVE_OUTPUT 的说明），
        // 不在这里挡的话一次 build 的日志会整份留在内存里直到关掉这个节点。
        item.output =
          e.output.length > MAX_LIVE_OUTPUT
            ? e.output.slice(0, MAX_LIVE_OUTPUT) +
              `\n…（已截断，原长 ${e.output.length} 字符；完整输出请到终端重跑）`
            : e.output
        break
      }
      case 'compacted': {
        // **CLI 把上下文压缩了 —— 界面这边也得跟着丢。**
        // 不丢的话：模型只剩一份摘要，界面却摆着满屏历史，人看着会以为它记得。
        // 这正是 contextLostOf 注释里判过「比空白更糟」的那种状态。
        //
        // **只保留最后一轮，其余全丢。**
        //
        // 这里原本写了一个「往回走找第一个不忙的轮次」的循环，被变异测试打回：
        // 本归约器里**只有最后一轮可能是忙的**（streamingTurn 每轮清空，running 的
        // exec 在 turn.done 那里收掉），所以那个循环在最后一轮忙时会**多留一轮**
        // —— 而那一轮早已被 CLI 压缩掉、模型根本不记得，留在界面上正是这次要治的病。
        //
        // 为什么最后一轮必须留：压缩可能发生在一轮进行到一半时，
        // 砍掉它会让**正在流式输出的回答凭空消失**。
        const dropped = Math.max(0, turns.length - 1)
        if (dropped > 0) turns.splice(0, dropped)
        // 分隔标记插在最前面 —— 它标的是「这条线以上的内容 agent 已经不记得了」
        turns.unshift({
          role: 'assistant',
          text: '',
          execs: [],
          compact: {
            trigger: e.trigger,
            preTokens: e.preTokens,
            postTokens: e.postTokens,
            droppedTurns: dropped
          }
        })
        break
      }
      case 'approval.request': {
        pending = { approvalId: e.approvalId, kind: e.kind, title: e.title, detail: e.detail, cwd: e.cwd }
        break
      }
      case 'approval.resolved': {
        // 不看 decision——allow/deny 都要清空，否则被拒绝的审批会卡死在界面上。
        pending = null
        break
      }
      case 'turn.done': {
        usage = e.usage
        // 省略时沿用上一次的值，不覆写成 undefined。依据不是随手选的体验偏好，是这个
        // 字段的来源语义：claudeEvents.ts 里 costUsd 取自 Claude 的 total_cost_usd——
        // 名字就是 total，是累计花费，不是本轮花费，因此不会倒退。这一轮的事件里没带
        // 这个字段，只说明适配器这次没报出来，不代表花费清零；把它覆写成 undefined 会
        // 让界面上的花费从有变没有，看起来像统计坏了或者归零，那是在显示假信息——跟
        // 「宁可少显示，也不要显示一个错的数字」是同一条原则。
        costUsd = e.costUsd ?? costUsd
        sawExecStartSinceTurnDone = false
        turnActive = false
        // **一轮结束了，就不该还有命令标着「在跑」** —— 收尾掉它们。
        //
        // 正常路径上 exec.done 先到，这一句是空转。它是为**中断**准备的：
        // 用户点「停」时进程可能正卡在一条命令上，那条 exec.done 永远不会来了。
        // 不收的话 anyRunning 一直为真 → busy 一直为真 →
        // 界面上「正在处理」不消失、发送键一直停在「停下这一轮」
        //（用户 2026-08-20 反馈的正是这两条）。
        //
        // 跟 history.ts 的 settleOnLoad 同一个道理：那边收的是「上次退出时卡在
        // 半路的记录」，这边收的是「这一轮被掐断时卡在半路的命令」。
        for (const t of turns) {
          for (const x of t.execs) if (x.state === 'running') x.state = 'failed'
        }
        // 一轮结束，流式那段已经落定。不清的话，下一轮第一个 text.done 会去覆盖
        // 上一轮的最后一个轮次（那时 delta 还没来得及开新的），表现成「新回答
        // 把旧回答改掉了」。
        streamingTurn = null
        break
      }
      case 'user.message': {
        // **归约器唯一一次产出用户消息**（文件头和 MessageList 头部那条
        // 「reduce 从不产出用户消息」的显式例外）。
        //
        // 只有手机端那条路会发这个事件 —— 桌面自己发的消息由 AgentChatView
        // 在调 send 之前就乐观插进对话流了，走这里会重复显示两条。
        //
        // 插在**当前末尾**：事件是按到达顺序来的，手机那条消息就是此刻发生的，
        // 它后面跟着的 assistant 轮次自然接在它下面。
        // 不需要 beforeTurnCount 那套（那是给「组件本地记录 + 事后合并」用的，
        // 这条一到就落位）。
        turns.push({ role: 'user', text: e.text, execs: [] })
        // **不动 streamingTurn**：上一轮如果还在流式输出，它的引用还挂在那儿，
        // 清掉的话那一轮剩下的 delta 会另起一个轮次，看起来像回答被劈成两半。
        break
      }
      case 'error': {
        // 任何情况都不丢弃：不分 fatal，一律进 notices。
        // 内容完全相同（文本 + fatal 都一样）的，合并到已有那条上计数——**不是丢弃**，
        // 那条 notice 仍然在界面上显示着，只是不再重复占版面（评审 I5，见 Notice.count）。
        // 位置保持不动（不把命中的那条挪到末尾）：一条已经在屏幕上的提醒因为"又发生了
        // 一次"而跳到别处，只会让人以为来了条新的。
        const same = notices.find((n) => n.text === e.message && n.fatal === e.fatal)
        if (same) {
          same.count += 1
          break
        }
        noticeSeq += 1
        notices.push({ id: `notice-${noticeSeq}`, text: e.message, fatal: e.fatal, count: 1, kind: e.kind })
        if (notices.length > MAX_NOTICES) notices.shift()
        // 致命错误 = 这一轮走不下去了（典型：spawn 失败）。不在这里收的话，
        // turn.done 永远不会来，界面会一直转下去。非致命的不动——那只是条提醒，
        // 会话还在正常跑。
        if (e.fatal) turnActive = false
        break
      }
      // session.ready / thinking / turn.start，以及任何未来新增但这一层还没接的事件类型：
      // 当前视图模型没有对应字段，忽略即可——但绝不能抛。
      //（text.delta 已经在上面接了，不再走这条路。）
      default:
        break
    }
  }

  function view(): ChatView {
    const anyRunning = turns.some((t) => t.execs.some((x) => x.state === 'running'))
    return {
      model,
      quotas,
      turns,
      pending,
      notices,
      usage,
      costUsd,
      // turnActive 补的是「会话就绪了但第一个字还没来」那一段（实测有 4 秒多，
      // 见它的定义处）——原来那两支都覆盖不到，界面在那段时间是彻底静止的。
      busy: anyRunning || sawExecStartSinceTurnDone || turnActive
    }
  }

  return { push, view }
}

/** 折叠时：最近三条 ∪ 全部失败项，按原顺序去重；展开时：原样全部返回。
 *  用 filter 而不是「失败项数组 + slice(-3) 拼接」——拼接会在失败项本就落在最近
 *  三条以内时把它重复放进结果两次。 */
export function visibleExecs(execs: ExecItem[], expanded: boolean): ExecItem[] {
  if (expanded) return execs
  const recentStart = Math.max(0, execs.length - 3)
  return execs.filter((e, i) => i >= recentStart || e.state === 'failed')
}
