// 「这次按键要不要发送」。纯函数、零 import，node --test 直接跑。
//
// ── 为什么不能只看 e.key === 'Enter' ──────────────────────────────────
// 中文/日文输入法在选候选词时，回车的语义是「确认这个候选词」。而 keydown 在
// composition 期间照样触发 —— 直接判 Enter 的话，用户打「你好」按回车确认，
// 消息就被发出去了，而他其实一个字都还没打完。这是中文用户最常撞的一类 bug。
//
// 判据是 `isComposing`（KeyboardEvent 的标准字段，组合期间为 true）。
// **不要用 keyCode === 229 那套老写法**：那是 Chrome 早期的 workaround，
// 现代浏览器里 isComposing 才是规范定义的、跨输入法一致的信号。
//
// ── 为什么改成 Ctrl+Enter ─────────────────────────────────────────────
// 用户要的：回车留给输入法和换行，发送要一个明确的组合键。
// Cmd+Enter 一并接受 —— mac 用户的肌肉记忆是 Cmd，两个都收不会有歧义
// （没有任何别的功能占用它们）。

export interface SendKeyEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  /** 输入法组合中。**这一位缺了就会误发**，调用方必须从原生事件取 */
  isComposing?: boolean
}

/**
 * 这次按键是不是「发送」。
 *
 * 只有 Ctrl+Enter / Cmd+Enter 是。裸 Enter 一律当换行（交给 textarea 默认行为），
 * 组合期间的任何键都不是。
 */
export function isSendKey(e: SendKeyEvent): boolean {
  if (e.isComposing) return false // 输入法在选词，回车是确认候选，不是发送
  if (e.key !== 'Enter') return false
  return e.ctrlKey === true || e.metaKey === true
}

/**
 * 这次按键要不要阻止默认行为。
 *
 * 发送时要挡（否则 textarea 会顺手插一个换行，发完输入框里留一个空行）；
 * 其余一律不挡 —— 裸 Enter 的默认行为正是换行，那是现在想要的。
 */
export function shouldPreventDefault(e: SendKeyEvent): boolean {
  return isSendKey(e)
}

/** 输入框提示语里那半句。两处输入框共用，免得一处改了另一处忘了。 */
export const SEND_HINT = '⌘/Ctrl+Enter 发送，Enter 换行'
