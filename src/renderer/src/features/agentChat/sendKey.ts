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
// ── 回车发送，Ctrl / Shift + 回车换行（2026-10-02 用户改回来）─────────────────
// 之前按用户当时的要求是「⌘/Ctrl+Enter 发送、Enter 换行」；这次用户要的是常见聊天软件的习惯：
// Enter 发送，Ctrl+Enter 或 Shift+Enter 换行（Alt+Enter 一并算换行）。
// ⌘+Enter 仍然算发送 —— 用了一阵旧规则的 mac 用户按它是想发，不能让它变成「没反应」。
// **回车直接发送之后，输入法那道闸更要紧**：按错一下就是把没打完的话发出去，见下面 isComposing / 229。
//
// 换行由编辑器自己插（ComposerInput 调 isNewlineKey）：CodeMirror 与浏览器对这几个组合键的默认行为不一致，
// mac 上 Ctrl+Enter 默认什么都不做，不能靠默认行为。

export interface SendKeyEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  /** 输入法组合中。**这一位缺了就会误发**，调用方必须从原生事件取 */
  isComposing?: boolean
  /** 229 = 输入法正在处理这次按键。isComposing 是规范信号，229 兜底
   *  （回车直接发送之后误发代价变大，两道闸都要；ComposerInput 的捕获阶段也是两个都认） */
  keyCode?: number
}

function composing(e: SendKeyEvent): boolean {
  return e.isComposing === true || e.keyCode === 229
}

/**
 * 这次按键是不是「发送」：裸 Enter（或 ⌘+Enter）。
 * 带 Ctrl / Shift / Alt 的回车是换行；组合期间的任何键都不是发送。
 */
export function isSendKey(e: SendKeyEvent): boolean {
  if (composing(e)) return false // 输入法在选词，回车是确认候选，不是发送
  if (e.key !== 'Enter') return false
  return !e.ctrlKey && !e.shiftKey && !e.altKey
}

/** 这次按键是不是「换行」：Ctrl / Shift / Alt + Enter。编辑器据此自己插入换行 */
export function isNewlineKey(e: SendKeyEvent): boolean {
  if (composing(e)) return false
  return e.key === 'Enter' && !e.metaKey && (e.ctrlKey === true || e.shiftKey === true || e.altKey === true)
}

/**
 * 这次按键要不要阻止默认行为。
 *
 * 发送时要挡 —— 否则编辑器会顺手插一个换行，发完输入框里留一个空行。
 */
export function shouldPreventDefault(e: SendKeyEvent): boolean {
  return isSendKey(e)
}

/** 输入框提示语里那半句。两处输入框共用，免得一处改了另一处忘了。 */
export const SEND_HINT = 'Enter 发送，Shift/Ctrl+Enter 换行' // i18n-allow: 仅测试引用；界面用词典键 chat.send.hint
