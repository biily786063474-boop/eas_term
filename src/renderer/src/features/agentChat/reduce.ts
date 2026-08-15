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
// ③ 没有打字机效果——text.delta 目前零生产者，收到即忽略：不追加、不建轮次、不占位。

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
}

export interface ChatView {
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

  /** exec.start 要挂到的轮次：有就用当前最后一个（本归约器只产出 assistant 轮次，
   *  所以「最后一个」必然是 assistant，不需要额外查 role）；没有就先造一个空文本的。 */
  function ensureAssistantTurn(): Turn {
    const last = turns[turns.length - 1]
    if (last) return last
    const created: Turn = { role: 'assistant', text: '', execs: [] }
    turns.push(created)
    return created
  }

  function push(e: ChatEvent): void {
    switch (e.k) {
      case 'text.done': {
        turns.push({ role: 'assistant', text: e.text, execs: [] })
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
        item.output = e.output
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
        break
      }
      case 'error': {
        // 任何情况都不丢弃：不分 fatal，一律追加进 notices。
        noticeSeq += 1
        notices.push({ id: `notice-${noticeSeq}`, text: e.message, fatal: e.fatal })
        break
      }
      // session.ready / thinking / text.delta，以及任何未来新增但这一层还没接的
      // 事件类型：当前视图模型没有对应字段，忽略即可——但绝不能抛。text.delta
      // 尤其不能在这里做「追加到草稿文字」之类的事，那就是在造打字机效果。
      default:
        break
    }
  }

  function view(): ChatView {
    const anyRunning = turns.some((t) => t.execs.some((x) => x.state === 'running'))
    return {
      turns,
      pending,
      notices,
      usage,
      costUsd,
      busy: anyRunning || sawExecStartSinceTurnDone
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
