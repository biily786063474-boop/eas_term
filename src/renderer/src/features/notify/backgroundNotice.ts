// 「后台运行中」这类提醒的三条判据（2026-09-29 用户要求）。
//
// AI 对话这一轮说完了、但 Claude 的 run_in_background 还在跑：这时照样提醒
// （AI 常在等你回话，见 03 号图纸「后台任务不是『完成』」），但**不能说成「完成」**——
// 提示音换一种、灵动岛/Dock 写「后台运行中」。
//
// **纯函数，不引 React / store。** 规则写错了不报错，只会让人听错一个音、
// 看错一个字，只有单测抓得住。接线见 useNoticeSound.ts 与 AgentChatView.tsx。

export type NoticeSound = 'done' | 'approval' | 'background'

/** store.ptyBackground 的一条：flag 那一刻后台里跑着什么。
 *  `at` 给灵动岛当通知身份用——后台一直在跑时运行态从不落下，lastDoneAt 不会变，
 *  只拿它做 id 的话第二轮的提醒会顶着第一轮的 id，不再自动弹出。 */
export interface BackgroundMark {
  at: number
  /** 后台任务个数 */
  count: number
  /** 第一个任务的名字（一行、截断），与对话底部「后台任务运行中 …」同源 */
  label: string
}

/** 灵动岛/Dock 里任务名只有一行的位置 */
const LABEL_MAX = 40

/**
 * 这一批新提醒该播哪种音。批次内有审批 → approval（最急，agent 卡着）；
 * 否则有后台运行中 → background；否则 done。
 * **整批只返回一个**：三个任务同时到不该响三声（useNoticeSound 只播这一次）。
 */
export function pickNoticeSound(
  fresh: readonly string[],
  approval: Readonly<Record<string, unknown>>,
  background: Readonly<Record<string, unknown>>
): NoticeSound {
  if (fresh.some((id) => approval[id])) return 'approval'
  if (fresh.some((id) => background[id])) return 'background'
  return 'done'
}

/** turn.done 要提醒时：后台还有任务就给出标记，没有就 null（照常按「完成」）。 */
export function backgroundMarkFor(
  view: { background: readonly { label: string }[] },
  at: number
): BackgroundMark | null {
  if (!view.background.length) return null
  const raw = view.background[0].label.replace(/\s+/g, ' ').trim()
  const label = raw.length > LABEL_MAX ? raw.slice(0, LABEL_MAX - 1) + '…' : raw
  return { at, count: view.background.length, label }
}

/** 后台清空后等续轮 turn.start 的宽限。Claude 跑完后台会自己再起一轮（background.wake），
 *  实测清空与续轮开始之间有间隔；这段时间里提醒保持「后台运行中」不动。
 *  超时还没续轮（CLI 没接着说）才转成普通完成，免得一直挂着。 */
export const BACKGROUND_WAKE_GRACE_MS = 5000

/** 定时器注入口：组件里传 setTimeout/clearTimeout，测试里传假定时器 */
export interface GraceTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface BackgroundGrace {
  /** 每条事件调一次。holdRunning = 这会儿运行态要替后台撑着；dropMark = 该摘「后台运行中」标记 */
  push(eventKind: string, view: { busy: boolean; background: readonly unknown[] }): { holdRunning: boolean; dropMark: boolean }
  /** 此刻是否在宽限中（定时器挂着、运行态正替后台撑着） */
  holding(): boolean
  /** 卸载 / 换会话时收掉定时器 */
  dispose(): void
}

/**
 * 「后台清空 → 续轮」之间的宽限（2026-09-29 真机：后台清空那一刻就摘标记、落运行态，
 * lastDoneAt 一变通知 id 跟着变，灵动岛弹出一张无声的「已完成 · 未取得该模块本轮的最终回答」，
 * 0.3 秒后又折回，3/3 复现）。
 *
 * 规则：只有 `turn.start` 摘标记；后台清空（且不在轮次里）时**不摘、不落运行态**，开一个
 * BACKGROUND_WAKE_GRACE_MS 的定时器；turn.start / 又有了新后台任务 / dispose 都取消它；
 * 到点才 onExpire（由调用方转成普通完成，见 expireBackgroundGrace）。
 */
export function createBackgroundGrace(timers: GraceTimers, onExpire: () => void): BackgroundGrace {
  let had = false
  let handle: unknown = null
  const cancel = (): void => {
    if (handle !== null) timers.clear(handle)
    handle = null
  }
  return {
    push(eventKind, view) {
      const has = view.background.length > 0
      if (eventKind === 'turn.start') {
        cancel()
        had = has
        return { holdRunning: false, dropMark: true }
      }
      if (has) {
        cancel()
        had = true
        return { holdRunning: false, dropMark: false }
      }
      if (had) {
        had = false
        // 轮次里清空的（AI 还在说）不用等续轮，这一轮的 turn.done 自然会提醒
        if (!view.busy) {
          cancel()
          handle = timers.set(() => {
            handle = null
            onExpire()
          }, BACKGROUND_WAKE_GRACE_MS)
        }
      }
      return { holdRunning: handle !== null, dropMark: false }
    },
    holding: () => handle !== null,
    dispose: cancel
  }
}

/** 这条链用到的几个 store action（真 store 与测试夹具都满足） */
export interface SignalStore {
  clearAttention(ptyId: string): void
  setPtyRunning(ptyId: string, running: boolean): void
  setPtyBackground(ptyId: string, mark: BackgroundMark | null): void
}

/**
 * AI 对话每条事件对全局信号的写入（AgentChatView 只调这一个，行为由单测钉住）。返回运行态。
 *
 * - `turn.start` 先 `clearAttention`：后台一直在跑时运行态从没落下，`setPtyRunning(true)` 那一跳
 *   不会发生，不清的话续轮 turn.done 的 flagAttention 是空操作——不响 done、岛上还挂着后台运行中
 * - 运行态 = busy || 后台非空 || 宽限中（宽限里落下运行态会改 lastDoneAt → 通知 id → 闪一张新卡）
 */
export function applyChatSignal(
  st: SignalStore,
  sid: string,
  eventKind: string,
  view: { busy: boolean; background: readonly unknown[] },
  grace: BackgroundGrace
): boolean {
  if (eventKind === 'turn.start') st.clearAttention(sid)
  const g = grace.push(eventKind, view)
  const running = view.busy || view.background.length > 0 || g.holdRunning
  st.setPtyRunning(sid, running)
  if (g.dropMark) st.setPtyBackground(sid, null)
  return running
}

export interface ExpireState extends SignalStore {
  attentionPtys: string[]
  ptyBackground: Record<string, BackgroundMark>
  ptyTiming: Record<string, { lastDoneAt?: number } | undefined>
}

/**
 * 宽限到期、续轮没来：转成普通完成。运行态落下（lastDoneAt 更新）→ 摘标记 → 通知 id 与响铃键
 * 都变，灵动岛按「已完成」弹一次、useNoticeSound 播 done。`onDoneAt` 在摘标记**之前**拿到新的
 * lastDoneAt，调用方用它把本轮回答重新登记给灵动岛（否则卡片是「未取得本轮最终回答」）。
 * 提醒已经被看过（不在 attentionPtys 里）就只落运行态，不补一条。返回是否转换了一条提醒。
 */
export function expireBackgroundGrace(
  getState: () => ExpireState,
  sid: string,
  onDoneAt: (doneAt: number) => void
): boolean {
  const st = getState()
  const pending = !!st.ptyBackground[sid] && st.attentionPtys.includes(sid)
  st.setPtyRunning(sid, false)
  if (pending) onDoneAt(getState().ptyTiming[sid]?.lastDoneAt ?? 0)
  getState().setPtyBackground(sid, null)
  return pending
}

/** useNoticeSound 记「响过没有」的键。带上标记时刻：标记摘掉（宽限到期转完成）键就变，
 *  会被当成新的一条按 done 再响一次；标记不变时键不变，不会重响。 */
export function ringKeyOf(ptyId: string, mark: { at: number } | undefined): string {
  return mark ? `${ptyId}#bg${mark.at}` : ptyId
}

export interface RetireState extends SignalStore {
  ptyBackground: Record<string, BackgroundMark>
}

/**
 * 开新对话时给**旧**会话 id 收尾（2026-09-30）。handleNewChat 会停掉旧会话、换上新 id，
 * 之后旧 id 的事件没人听，卸载清理读 sessionIdRef 时也已是新 id——旧会话若正处在
 * 「后台运行中」或 5 秒宽限里，运行态被后台/宽限撑着，从此永远挂在「运行中」。
 *
 * 只在旧会话确实处于这几种态时收：宽限中 / 挂着后台运行中标记 / 后台列表非空（进程要被停，
 * 后台任务随之结束）。前台真在跑（busy）不碰——handleNewChat 本就拦着，这里再兜一层；
 * 普通「已完成」提醒也不碰，照旧留给用户看。宽限定时器无论如何都收掉。返回是否收了尾。
 */
export function retireChatSession(
  getState: () => RetireState,
  sid: string,
  grace: BackgroundGrace | null,
  view: { busy: boolean; background: readonly unknown[] } | null
): boolean {
  const inGrace = grace?.holding() ?? false
  grace?.dispose()
  if (view?.busy) return false
  const st = getState()
  if (!inGrace && !st.ptyBackground[sid] && !(view && view.background.length > 0)) return false
  st.clearAttention(sid)
  getState().setPtyRunning(sid, false)
  getState().setPtyBackground(sid, null)
  return true
}
