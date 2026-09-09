import { flushSync } from 'react-dom'
// Shared selection splice; never guess an invalid position by appending to the end.
export function spliceVoice(value: string, start: number, end: number, text: string): {value: string; caret: number} | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > value.length) return null
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length }
}

type VoiceEditor = HTMLElement & {
  value: string
  insertVoiceText?: (text: string) => void
  selectionStart: number | null
  selectionEnd: number | null
  setSelectionRange(start: number, end: number): void
}

/** Use the editor's selection API (also supported by ComposerInput), not DOM text mutation. */
export function insertVoiceAtSelection(el: VoiceEditor | null, text: string, setValue: (value: string) => void): boolean {
  if (!el?.isConnected || el.hasAttribute('readonly') || el.hasAttribute('disabled') || el.getAttribute('type') === 'password') return false
  if (el.insertVoiceText) { el.insertVoiceText(text); return true }
  const result = spliceVoice(el.value, el.selectionStart ?? -1, el.selectionEnd ?? -1, text)
  if (!result) return false
  flushSync(() => setValue(result.value))
  // Multiple finals in one stop response must see the previous insertion immediately.
  if (el.value === result.value) el.setSelectionRange(result.caret, result.caret)
  requestAnimationFrame(() => {
    if (!el.isConnected || el.value !== result.value) return
    // Do not steal focus from a different editor while the framework is rendering.
    const active = document.activeElement
    if (active && active !== document.body && active !== el && !el.contains(active)) return
    el.focus()
    el.setSelectionRange(result.caret, result.caret)
  })
  return true
}
