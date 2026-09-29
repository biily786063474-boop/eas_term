// 按 leafId 登记的「把键盘焦点放进这个节点的输入」入口（Task 10：插件 ui/message 注入成功后聚焦过去）。
// AI 对话：空态 AgentChatView / 对话态 ChatToolbar 的输入框（光标置末尾）；终端：xterm `term.focus()`。
// 和 chipTargets 同一个键、同一条注销规矩（只删仍是自己的那个 —— 空态→对话态交接时新的可能先挂上）。
// 放模块级 Map 而不是 store：纯命令式入口，不需要触发渲染；也方便在 node 里直接测（同 terminal/pasteModes.ts）。
type Focus = () => void
const targets = new Map<string, Focus>()

/** 返回注销函数；注销只删仍是自己的那个。 */
export function registerInputFocus(leafId: string, focus: Focus): () => void {
  targets.set(leafId, focus)
  return () => {
    if (targets.get(leafId) === focus) targets.delete(leafId)
  }
}

/** 找到登记就聚焦并返回 true；没登记 / 聚焦抛错（组件已销毁）→ false，调用方静默跳过。 */
export function focusInputOf(leafId: string): boolean {
  const focus = targets.get(leafId)
  if (!focus) return false
  try {
    focus()
    return true
  } catch {
    return false
  }
}
