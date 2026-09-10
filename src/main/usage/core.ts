import type { Meter, UsageMeta, UsageRow, UsageSummary } from '../../shared/usage.ts'
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
/** Normalizes only explicitly reported measurements. Missing usage is never zero. */
export function measure(cli: string, raw: Record<string, unknown>): Meter | undefined {
  const input = raw[cli === 'omp' ? 'inputTokens' : 'input_tokens']
  const output = raw[cli === 'omp' ? 'outputTokens' : 'output_tokens']
  if (!valid(input) || !valid(output)) return undefined
  const read = raw[cli === 'claude' ? 'cache_read_input_tokens' : cli === 'omp' ? 'cachedReadTokens' : 'cached_input_tokens']
  const write = raw[cli === 'claude' ? 'cache_creation_input_tokens' : 'cachedWriteTokens']
  const cacheRead = valid(read) ? read : undefined
  const cacheWrite = valid(write) ? write : undefined
  return {
    input: cli === 'omp' && valid(raw.totalTokens) && raw.totalTokens >= output + input
      ? raw.totalTokens - output
      : input + (cli === 'claude' || cli === 'omp' ? (cacheRead ?? 0) + (cacheWrite ?? 0) : 0), output,
    ...(cacheRead !== undefined ? {cacheRead} : {}), ...(cacheWrite !== undefined ? {cacheWrite} : {})
  }
}
export class UsageBook {
  rows: UsageRow[] = []
  private pending = new Map<string, UsageRow[]>()
  private costs = new Map<string, number>()
  start(meta: UsageMeta, id: string, at: number): void {
    if (this.rows.some(r=>r.id===id)) return
    const row: UsageRow = {...meta, id, startedAt: at, status:'running'}
    this.rows.push(row); const queue=this.pending.get(meta.session)??[]; queue.push(row); this.pending.set(meta.session,queue)
  }
  markInterrupted(session: string): void { const row=this.pending.get(session)?.[0]; if(row) row.status='interrupted' }
  abort(session: string, at: number): void {while(this.pending.has(session)) this.finish(session,undefined,undefined,at,'interrupted')}
  resetCost(session: string): void { this.costs.delete(session) }
  finish(session: string, meter: Meter | undefined, cumulative: number | undefined, at: number, status: UsageRow['status'] = 'completed'): void {
    const queue = this.pending.get(session)
    const row = queue?.shift()
    if (!row) return
    if(!queue?.length) this.pending.delete(session)
    row.endedAt = at; row.status = row.status === 'interrupted' ? 'interrupted' : status; row.meter = meter
    if (valid(cumulative)) {
      const prev = this.costs.get(session)
      if (prev !== undefined && cumulative >= prev) row.costUsd = cumulative - prev
      this.costs.set(session,cumulative)
    } else {
      // A gap must not charge its cumulative cost to the next measured round.
      this.costs.delete(session)
    }
  }
  prune(now: number, age = 90*86400000, max = 50000): void {
    this.rows = this.rows.filter(r => r.startedAt >= now-age).slice(-max)
    const kept = new Set(this.rows.map(r=>r.id))
    for (const [session,rows] of this.pending) {
      const queue=rows.filter(r=>kept.has(r.id)); if(queue.length)this.pending.set(session,queue);else this.pending.delete(session)
    }
  }
}
export function summarize(rows: UsageRow[], from: number, to: number, project?: string): UsageSummary {
  const s: UsageSummary = {rounds:0,known:0,tokens:0,input:0,output:0,cacheRead:0,cacheWrite:0,cacheKnown:0,cacheWriteKnown:0,costUsd:0,costKnown:0,interrupted:0,maxTokens:0}
  for (const r of rows) {
    if (r.startedAt < from || r.startedAt >= to || (project && r.project !== project)) continue
    s.rounds++; if (r.status==='interrupted') s.interrupted++
    if (r.meter) {
      const m=r.meter; s.known++; s.input+=m.input; s.output+=m.output; s.tokens+=m.input+m.output
      s.maxTokens=Math.max(s.maxTokens,m.input+m.output)
      if (m.cacheRead !== undefined) { s.cacheKnown++; s.cacheRead+=m.cacheRead }
      if(m.cacheWrite!==undefined){s.cacheWriteKnown++;s.cacheWrite+=m.cacheWrite}
    }
    if (r.costUsd !== undefined) {s.costKnown++; s.costUsd+=r.costUsd}
  }
  return s
}
