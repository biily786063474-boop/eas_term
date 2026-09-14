/** History catalog metadata only; full-text matching stays in the main process. */
export interface HistorySummary {
  leafId: string
  resumeId: string | null
  savedAt: number
  turns: number
  preview: string
  moduleId: string | null
  pinned: boolean
}
type Snapshot = { cwd?: unknown; moduleId?: unknown; pinned?: unknown; savedAt?: unknown; resumeId?: unknown; turns?: {role?: string; text?: string}[] }
export function historyMatches(raw: Snapshot, cwd: string, query: string): boolean {
  if (raw.cwd !== cwd || !Array.isArray(raw.turns) || !raw.turns.length) return false
  const q = query.trim().toLocaleLowerCase()
  return !q || raw.turns.some(t => typeof t?.text === 'string' && t.text.toLocaleLowerCase().includes(q))
}
export function historySummary(key: string, raw: Snapshot): HistorySummary {
  const turns = Array.isArray(raw.turns) ? raw.turns : []
  const first = turns.find(t => t?.role === 'user') ?? turns[0]
  return { leafId: key, resumeId: typeof raw.resumeId === 'string' ? raw.resumeId : null,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0, turns: turns.length,
    preview: typeof first?.text === 'string' ? first.text.slice(0, 100) : '',
    moduleId: typeof raw.moduleId === 'string' ? raw.moduleId : null, pinned: raw.pinned === true }
}
