// 画布撤销栈。纯函数、零 import（node --test 直接跑，同 selKey.ts / mediaExts.ts）。
//
// ── 为什么是快照而不是逆操作 ────────────────────────────────────────────
// 画布有 53 个会改 canvas 的 action。给每个都写一份逆操作，等于把正确性押在
// 「53 处都写对了、以后新增的第 54 处也记得写」上——漏一个就是撤销撤出脏状态，
// 而且是那种当场看不出、过几步才炸的脏。快照没有这个失败模式：存的是结果，
// 不是怎么走到结果的。
//
// 代价是内存。实测一个重度画布序列化后几百 KB，20 份即几 MB —— 对一个 Electron
// 应用不值得为此换成逆操作。
//
// ── 存 JSON 字符串而不是对象 ───────────────────────────────────────────
// 对象快照会把整棵场景树留在内存里（且与 store 里的对象共享子树，将来某处不小心
// 原地改一下就污染了历史）。字符串是死的，改不动，也便于「和上一份比一比，
// 真的变了才落栈」——引用变化不等于内容变化，画布里不少 action 会重建数组
// 但内容一模一样（reflowFrames 之类）。

/** 栈上限。20 是用户定的。 */
export const UNDO_LIMIT = 20

export interface UndoState {
  /** 历史状态，最旧在前。**不含当前状态** —— 当前状态在 store 里。 */
  past: string[]
  /** 撤销后被推到未来的状态，最近一次撤销的在最前。 */
  future: string[]
}

export const emptyUndo = (): UndoState => ({ past: [], future: [] })

/**
 * 记一步。返回新栈；**内容与栈顶相同则原样返回**（连引用都不变，
 * 免得白白触发一次渲染）。
 *
 * 落新的一步会清空 future：这是撤销栈的通行语义——撤回去几步之后又动手改了，
 * 原来那条「未来」就不再可达了。
 */
export function pushUndo(st: UndoState, snapshot: string, limit = UNDO_LIMIT): UndoState {
  if (st.past.length > 0 && st.past[st.past.length - 1] === snapshot) {
    return st.future.length === 0 ? st : { past: st.past, future: [] }
  }
  const past = [...st.past, snapshot]
  // 超限丢最旧的。limit<=0 视为不留历史（防御，正常不会传）
  return { past: limit > 0 ? past.slice(-limit) : [], future: [] }
}

export interface UndoStep {
  next: UndoState
  /** 要应用到画布上的那份快照 */
  snapshot: string
}

/** 撤销一步。栈空返回 null（调用方据此决定是不是给个「没有可撤销的操作」提示）。 */
export function stepUndo(st: UndoState, current: string, limit = UNDO_LIMIT): UndoStep | null {
  if (st.past.length === 0) return null
  const snapshot = st.past[st.past.length - 1]
  return {
    next: { past: st.past.slice(0, -1), future: [current, ...st.future].slice(0, limit) },
    snapshot
  }
}

/** 重做一步。 */
export function stepRedo(st: UndoState, current: string, limit = UNDO_LIMIT): UndoStep | null {
  if (st.future.length === 0) return null
  const snapshot = st.future[0]
  return {
    next: { past: [...st.past, current].slice(-limit), future: st.future.slice(1) },
    snapshot
  }
}

/**
 * 场景 → 快照字符串。**刻意不含 viewport** —— 撤销一次删除时把镜头也拽回去，
 * 人会当场迷失（「我的东西呢」）。撤销改的是内容，不是你在看哪儿。
 *
 * 参数写成结构类型而不是 import CanvasScene：这个文件要保持零 import，
 * node --test 才跑得动（tidyOrder.ts 立的规矩）。
 */
export function snapshotOf(c: {
  frames: unknown
  shapes: unknown
  freeNodes: unknown
  todos: unknown
}): string {
  return JSON.stringify({ frames: c.frames, shapes: c.shapes, freeNodes: c.freeNodes, todos: c.todos })
}

/** 快照 → 场景的四个字段。解析失败返回 null（历史是本地内存，坏了就当没有，别炸）。 */
export function parseSnapshot(
  snapshot: string
): { frames: unknown; shapes: unknown; freeNodes: unknown; todos: unknown } | null {
  try {
    const v = JSON.parse(snapshot) as Record<string, unknown>
    if (!v || typeof v !== 'object') return null
    if (!Array.isArray(v.frames) || !Array.isArray(v.shapes)) return null
    if (!Array.isArray(v.freeNodes) || !Array.isArray(v.todos)) return null
    return v as { frames: unknown; shapes: unknown; freeNodes: unknown; todos: unknown }
  } catch {
    return null
  }
}
