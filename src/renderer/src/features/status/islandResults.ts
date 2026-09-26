// 每次 attach 独立收集，绝不从项目目录猜 AI 对话的来源。
export interface IslandResult { answer: string; ask: string; at: number; round: number }
export function createIslandResultCollector() {
  let round = 0, answer = '', streaming = false
  let completed: IslandResult | undefined
  return {
    push(e: { k: string; text?: string; interrupted?: boolean }): IslandResult | undefined {
      if (e.k === 'turn.start') { round++; answer = ''; streaming = false; completed = undefined }
      if (e.k === 'exec.start' || e.k === 'exec.done') { answer = ''; streaming = false }
      if (e.k === 'text.delta') {
        if (!streaming) answer = ''
        streaming = true
        answer += e.text ?? ''
      }
      if (e.k === 'text.done') { answer = e.text ?? ''; streaming = false }
      if (e.k === 'turn.done') {
        if (e.interrupted) { completed = undefined; answer = ''; streaming = false; return undefined }
        completed = { answer: answer.trim().slice(0, 260), ask: '', at: Date.now(), round }
        return completed
      }
      return undefined
    },
    current(result: IslandResult): boolean { return completed === result }
  }
}
export function islandReadKey(parts: unknown[]): string { return JSON.stringify(parts) }

interface BoundResult { leafId: string; result: IslandResult; doneAt: number }
const results = new Map<string, BoundResult>()
export function putIslandResult(id: string, leafId: string, result: IslandResult, doneAt: number): void {
  results.delete(id)
  results.set(id, { leafId, result, doneAt })
  // 有限缓存；关模块/换轮次也会主动清理。
  if (results.size > 128) results.delete(results.keys().next().value!)
}
export function dropIslandResult(id: string): void { results.delete(id) }
export function getIslandResult(id: string, leafId: string, doneAt: number): IslandResult | undefined {
  const entry = results.get(id)
  return entry?.leafId === leafId && entry.doneAt === doneAt ? entry.result : undefined
}
