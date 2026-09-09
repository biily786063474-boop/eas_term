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

type NativeEdit = {before: string; after: string; start: number; end: number; caret: number}
const histories = new WeakMap<VoiceEditor, {past: NativeEdit[]; future: NativeEdit[]; set: (value:string)=>void}>()
function rememberVoice(el: VoiceEditor, edit: NativeEdit, setValue: (value:string)=>void): void {
  let history = histories.get(el)
  if (!history) {
    history = {past:[],future:[],set:setValue}; histories.set(el,history)
    el.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase(), redo = (key === 'z' && event.shiftKey) || key === 'y'
      if (key !== 'z' && key !== 'y') return
      const h = histories.get(el)!, source = redo ? h.future : h.past, item = source.at(-1)
      if (!item || el.value !== (redo ? item.before : item.after)) return
      event.preventDefault(); event.stopPropagation(); source.pop()
      ;(redo ? h.past : h.future).push(item)
      flushSync(() => h.set(redo ? item.after : item.before))
      el.setSelectionRange(redo ? item.caret : item.start, redo ? item.caret : item.end)
      el.dispatchEvent(new Event('voice:document-edit', {bubbles:true}))
    })
  }
  history.set = setValue; history.past.push(edit); history.future = []
  if (history.past.length > 20) history.past.shift()
}

/** Use the editor's selection API (also supported by ComposerInput), not DOM text mutation. */
export function insertVoiceAtSelection(el: VoiceEditor | null, text: string, setValue: (value: string) => void): boolean {
  if (!el?.isConnected || el.hasAttribute('readonly') || el.hasAttribute('disabled') || el.getAttribute('type') === 'password') return false
  if (el.insertVoiceText) { el.insertVoiceText(text); return true }
  const result = spliceVoice(el.value, el.selectionStart ?? -1, el.selectionEnd ?? -1, text)
  if (!result) return false
  rememberVoice(el, {before:el.value,after:result.value,start:el.selectionStart!,end:el.selectionEnd!,caret:result.caret}, setValue)
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
