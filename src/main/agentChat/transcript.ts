// 每个会话的对话摘要，留在主进程里。**零 import，能单测。**
//
// ── 为什么主进程要记这个（2026-08-30）────────────────────────────
// 手机端第二步是「收发消息」。发那半直接进主进程就行；**收那半原来无处可取** ——
// 对话内容只活在渲染层那个 AgentChatView 组件的归约器里，而画布会把视口外的
// 面板整个裁掉（PaneLayer 的视口裁剪）。也就是说「手机上能不能看到回复」
// 会取决于「你电脑上的画布此刻滚到哪儿」—— 而这功能正是为够不着电脑时用的。
//
// 所以在主进程留一份。主进程手里本来就有完整事件流，记下来几乎不花什么。
//
// ── 只记「说完的话」，不记流式增量 ──────────────────────────────
// 挂在 `text.done`（每轮一次）而不是 `text.delta`（每几十毫秒一次）。
// 挂错地方会让这份记录变成事件流上的热点 —— 而它只是给手机看的旁支。
//
// ── 有上限，而且是两层 ────────────────────────────────────────────
// ① 每个会话留多少条  ② 每条留多长
// 少了哪一层都能被撑爆：一个会话聊上几百轮，或者一次贴进来一份几 MB 的日志。
// 用户长期高强度使用这个软件，无上限的驻留结构就是泄漏。

/** 一条对话记录。**不含执行项/工具调用** —— 手机上要看的是「它说了什么」，
 *  不是「它跑了哪些命令」，后者在小屏上只会把正文挤没。 */
export interface TranscriptEntry {
  role: 'user' | 'assistant'
  text: string
  at: number
}

/** 每个会话留多少条。40 条 ≈ 20 个来回，手机上翻起来也就到头了 */
export const MAX_ENTRIES = 40
/** 单条留多长。超出截断并标出来 —— **不能悄悄截**，
 *  否则用户以为 agent 就说了这么多 */
export const MAX_TEXT = 4000

export interface TranscriptStore {
  /** 记一条。text 为空白时**不记** —— 空气泡在手机上尤其莫名其妙 */
  push(sessionId: string, role: TranscriptEntry['role'], text: string, at: number): void
  /** 取最近若干条，**旧的在前**（手机上从上往下读） */
  recent(sessionId: string, n?: number): TranscriptEntry[]
  /** 会话没了就丢掉它那份 —— 不清的话，开一天软件攒下的是所有关过的会话 */
  drop(sessionId: string): void
  size(sessionId: string): number
}

export function createTranscriptStore(
  maxEntries = MAX_ENTRIES,
  maxText = MAX_TEXT
): TranscriptStore {
  const byId = new Map<string, TranscriptEntry[]>()
  return {
    push(sessionId, role, text, at) {
      if (!sessionId) return
      const t = (text ?? '').trim()
      if (!t) return
      const clipped = t.length > maxText ? t.slice(0, maxText) + `\n…（还有 ${t.length - maxText} 字，回电脑上看）` : t
      let list = byId.get(sessionId)
      if (!list) {
        list = []
        byId.set(sessionId, list)
      }
      list.push({ role, text: clipped, at })
      // 超了从最旧的丢。**不 clear()** —— 那会让手机上的记录周期性整段消失
      if (list.length > maxEntries) list.splice(0, list.length - maxEntries)
    },
    recent(sessionId, n = maxEntries) {
      const list = byId.get(sessionId)
      if (!list) return []
      return list.slice(-n)
    },
    drop(sessionId) {
      byId.delete(sessionId)
    },
    size(sessionId) {
      return byId.get(sessionId)?.length ?? 0
    }
  }
}
