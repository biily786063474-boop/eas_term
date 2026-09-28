import { optionsOf } from './options.ts'

interface AssistTurn { role: string; text: string; compact?: unknown; unsentText?: string }
/** Only the caller's loaded conversation. No global storage or model requests. */
export function composerHistory(turns: readonly AssistTurn[]): string[] {
  const items: string[] = [], seen = new Set<string>()
  for (let i = turns.length - 1; i >= 0 && items.length < 50; i--) {
    const t = turns[i]
    if (t.role !== 'user' || t.compact || t.unsentText || !t.text.trim() || seen.has(t.text)) continue
    seen.add(t.text); items.push(t.text)
  }
  return items
}
export function composerSuggestion(turns: readonly AssistTurn[], unavailable = false): string {
  if (unavailable) return ''
  // Never resurrect options from a question that the user already answered.
  for (let i = turns.length - 1, scanned = 0; i >= 0 && scanned < 8; i--, scanned++) {
    const t = turns[i]
    if (t.role !== 'assistant' || t.compact || t.unsentText) break
    if (t.text.length > 24000) continue
    const options = optionsOf(t.text)?.options
    if (options?.length) return (options.find(o => /[（(](?:推荐|recommended)[）)]/i.test(o.label)) ?? options[0]).label
  }
  return ''
}
export interface HistoryCursor { items: readonly string[]; index: number; draft: string }
export function historyStep(cursor: HistoryCursor | null, key: string, text: string, history: readonly string[]): { text: string; state: HistoryCursor | null } | null {
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null
  if (cursor && text !== cursor.items[cursor.index]) return null
  if (!cursor) {
    if (key !== 'ArrowUp' || text !== '' || !history.length) return null
    return {text:history[0],state:{items:[...history],index:0,draft:text}}
  }
  const index = key === 'ArrowUp' ? Math.min(cursor.index + 1, cursor.items.length - 1) : cursor.index - 1
  return index < 0 ? {text:cursor.draft,state:null} : {text:cursor.items[index],state:{...cursor,index}}
}
export function acceptsAssistKey(e: {key:string; text:string; from:number; to:number; keyCode?:number; isComposing?:boolean; ctrlKey?:boolean; altKey?:boolean; metaKey?:boolean; shiftKey?:boolean; menuOpen?:boolean; disabled?:boolean}): boolean {
  return ['Tab','ArrowUp','ArrowDown'].includes(e.key) && !e.isComposing && e.keyCode !== 229 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.menuOpen && !e.disabled && e.from === e.to && e.to === e.text.length
}
