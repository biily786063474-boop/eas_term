// 用户自己发出去的消息，怎么合回对话流里。
//
// 背景：归约器**从不产出 `role: 'user'` 的轮次** —— CLI 不回显用户输入，
// 事件流里只有模型那一侧。所以用户发的话先记在这里，渲染时再插回去。
//
// 从 AgentChatView.tsx 提出来是因为它埋在组件文件里没法单测，
// 而它与归约器的裁剪之间有一条跨模块的不变量（见 mergeUserMessages 的注释）——
// 那正是「聊了几十轮之后自己发的话全没了」那个 bug 的藏身处。
import type { ChatView, Turn } from './reduce.ts'

/** 一条已发出的用户消息。`beforeTurnCount` 是它在轮次序列里的插入位置。 */
export interface SentMessage {
  text: string
  /** 记录时 `reducer.view().turns.length` 的值 —— 即「这条消息发出去时，前面已有多少轮」*/
  beforeTurnCount: number
  /** 这条消息带的图（缩略图，只为界面预览）。发给 CLI 的是路径，不是这个 */
  images?: { path: string; url: string }[]
}

/**
 * 把用户发过的消息插回轮次序列。
 *
 * ⚠️ **`beforeTurnCount` 记的是绝对下标，而归约器会从头部删轮次** ——
 * `trimTurns()` 在超过 MAX_LIVE_TURNS 时砍，压缩时更狠（只留最后一轮）。
 * 删完之后所有绝对下标都偏了，所以这里必须减去 `view.trimmedFromHead`。
 *
 * 不减的后果不是「位置歪一点」，是**消息成批消失**：插入靠 `=== i` 精确匹配、
 * `sentIdx` 又是单调游标，一旦某条的下标落到 `turns.length` 之外就永远匹配不上，
 * 游标卡死，**它和它后面的所有用户消息一起不见**。
 * 症状就是「聊了几十轮之后，自己发的话全没了，切个视图又回来」
 * （切视图会从磁盘重载 restored.turns，那份是存过的合并结果）。
 */
export function mergeUserMessages(view: ChatView, sent: SentMessage[]): ChatView {
  if (sent.length === 0) return view
  // 归约器从头删过多少轮。被删区间里的消息用 max(0, …) 落到开头 ——
  // 它们的上下文确实已经被砍掉了，摆在最前面是诚实的位置。
  const trimmed = view.trimmedFromHead ?? 0
  const posOf = (m: SentMessage): number => Math.max(0, m.beforeTurnCount - trimmed)
  const merged: Turn[] = []
  const take = (m: SentMessage): void => {
    merged.push({ role: 'user', text: m.text, execs: [], images: m.images })
  }
  let sentIdx = 0
  for (let i = 0; i <= view.turns.length; i++) {
    while (sentIdx < sent.length && posOf(sent[sentIdx]) === i) {
      take(sent[sentIdx])
      sentIdx += 1
    }
    if (i < view.turns.length) merged.push(view.turns[i])
  }
  // 兜底：走完还有没插进去的，一律追加到末尾。
  // 减完偏移之后位置应当都落在 [0, turns.length] 里，所以这里理论上不会执行；
  // 留着是因为**丢消息比位置不准严重得多** —— 真出现新的删除路径时，
  // 最坏也只是顺序不对，而不是「用户看着自己的话凭空消失」。
  while (sentIdx < sent.length) {
    take(sent[sentIdx])
    sentIdx += 1
  }
  return { ...view, turns: merged }
}
