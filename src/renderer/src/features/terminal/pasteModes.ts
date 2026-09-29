// 每个 pty 此刻的前台程序有没有开 bracketed paste（DECSET 2004）。
// 状态只在渲染层的 xterm 实例里（`term.modes.bracketedPasteMode`），TerminalView 挂载时按 ptyId 登记一个读取函数。
// 用途：插件 ui/message 往终端粘贴多行前先问一句 —— 没开 2004 的程序会把换行当回车逐行执行。
// 终端节点没挂载（没有 xterm 实例）就读不到，返回 undefined，由调用方决定怎么退（见 uiMessage.ts terminalPastePlan）。
type Read = () => boolean
const readers = new Map<string, Read>()

/** 返回注销函数；注销只删仍是自己的那个（同一 ptyId 重挂载时新的可能先登记）。 */
export function registerPasteMode(ptyId: string, read: Read): () => void {
  readers.set(ptyId, read)
  return () => {
    if (readers.get(ptyId) === read) readers.delete(ptyId)
  }
}

export function bracketedPasteOf(ptyId: string): boolean | undefined {
  const read = readers.get(ptyId)
  if (!read) return undefined
  try {
    return read()
  } catch {
    return undefined
  }
}
