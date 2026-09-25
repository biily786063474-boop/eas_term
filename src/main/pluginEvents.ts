/** Main-only event transport. This is NOT an authorization API: the host must
 * validate the plugin declaration and user grant before calling enable().
 * Never expose enable/publish directly through model tools or renderer payloads.
 */
export interface PluginTurnEvent {
  kind: 'agent.turn.completed'
  eventId: string
  projectId: string
  text: string
  originalQuestion?: string
  outcome: 'completed' | 'failed' | 'cancelled'
  sessionId?: string
  turnId?: string
  date?: string
  completedAt?: string
  recorded?: boolean
}
type Sink = (event: PluginTurnEvent, signal: AbortSignal) => Promise<void>
interface Subscription {
  projects: Set<string>
  queue: PluginTurnEvent[]
  controller: AbortController
  sink: Sink
  scheduled: boolean
}
export class PluginEventBus {
  private subscriptions = new Map<string, Subscription>()
  private readonly capacity: number
  private readonly report: (pluginId: string, message: string) => void
  constructor(capacity = 64, report: (pluginId: string, message: string) => void = () => {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256) throw Error('事件队列容量无效')
    this.capacity = capacity
    this.report = report
  }
  enable(pluginId: string, authorizedProjectIds: readonly string[], sink: Sink): void {
    if (!pluginId || authorizedProjectIds.some(id => typeof id !== 'string' || !id)) throw Error('事件订阅身份无效')
    this.disable(pluginId)
    this.subscriptions.set(pluginId, { projects: new Set(authorizedProjectIds), queue: [], controller: new AbortController(), sink, scheduled: false })
  }
  disable(pluginId: string): void {
    const old = this.subscriptions.get(pluginId)
    if (!old) return
    this.subscriptions.delete(pluginId)
    old.controller.abort()
    old.queue.length = 0
  }
  publish(event: PluginTurnEvent, onlyPlugin?: string): void {
    if (event.kind !== 'agent.turn.completed' || !event.eventId || !event.projectId || typeof event.text !== 'string') return
    for (const [pluginId, sub] of this.subscriptions) {
      if (onlyPlugin && onlyPlugin !== pluginId) continue
      if (!sub.projects.has(event.projectId)) continue
      if (sub.queue.length >= this.capacity) { this.error(pluginId, '事件队列已满，部分候选未捕获'); continue }
      // Construct a whitelist copy; never forward arbitrary event fields/secrets.
      sub.queue.push({ kind: event.kind, eventId: event.eventId, projectId: event.projectId,
        text: event.text.slice(0, 4000), originalQuestion: typeof event.originalQuestion === 'string' ? event.originalQuestion.slice(0, 4000) : undefined, outcome: event.outcome,
        sessionId: event.sessionId, turnId: event.turnId, date: event.date,
        completedAt: event.completedAt, recorded: event.recorded })
      if (!sub.scheduled) {
        sub.scheduled = true
        queueMicrotask(() => { void this.drain(pluginId, sub) })
      }
    }
  }
  private error(pluginId: string, message: string): void {
    try { this.report(pluginId, message) } catch { /* telemetry must not break chat */ }
  }
  private async drain(pluginId: string, sub: Subscription): Promise<void> {
    try {
      while (this.subscriptions.get(pluginId) === sub && !sub.controller.signal.aborted) {
        const event = sub.queue.shift()
        if (!event) break
        // Sink must recheck signal at its final write boundary. Already committed
        // data is retained on disable; queued/uncommitted work is revoked.
        try { await sub.sink(event, sub.controller.signal) }
        catch (e) { if (!sub.controller.signal.aborted) this.error(pluginId, e instanceof Error ? e.message : '插件事件处理失败') }
      }
    } finally { sub.scheduled = false }
  }
  dispose(): void {
    for (const id of this.subscriptions.keys()) this.disable(id)
  }
}

// No model/tool mutation: listen only to already-normalized main-process events.
interface TurnBuffer { id: string; text: string; failed: boolean; recorded: boolean }
const turns = new Map<string, TurnBuffer>()
const questions = new Map<string, string>()
const continuation = /^(?:(?:好(?:的|吧|啊)?|可以|对的|嗯|ok|yes)[，,\s]*)?(?:(?:按计划)?继续(?:推进|做)?|接着(?:做)?)?(?:吧|啊|呀)?[。！!，,\s]*$/i
let receiver: ((cwd: string, event: PluginTurnEvent) => void) | undefined
let serial = 0
export function setPluginTurnReceiver(next?: typeof receiver): void { receiver = next; if (!next) { turns.clear(); questions.clear() } }
export function cancelPluginTurn(sessionId: string): void { const t=turns.get(sessionId); if(t)t.failed=true }
export function markPluginTurnRecorded(sessionId: string): void { const turn = turns.get(sessionId); if (turn) turn.recorded = true }
export function observePluginTurn(sessionId: string, cwd: string, event: { k: string; text?: string; fatal?: boolean }): void {
  if (!receiver) return
  if (event.k === 'user.message' && typeof event.text === 'string') {
    const question = event.text.trim().slice(0, 4000)
    if (question && !continuation.test(question)) {
      if (questions.size >= 200) questions.delete(questions.keys().next().value!)
      questions.set(sessionId, question)
    }
  }
  if (event.k === 'turn.start' && (!turns.has(sessionId) || turns.get(sessionId)!.failed)) {
    if (turns.size >= 200) turns.delete(turns.keys().next().value!)
    turns.set(sessionId, { id: Date.now() + '-' + (++serial), text: '', failed: false, recorded: false })
  }
  if (event.k === 'text.done') {
    if (!turns.has(sessionId)) { if (turns.size >= 200) turns.delete(turns.keys().next().value!); turns.set(sessionId, { id: Date.now() + '-' + (++serial), text: '', failed: false, recorded: false }) }
    const t = turns.get(sessionId)!
    t.text = (t.text + '\n' + (event.text ?? '')).slice(-4000)
  }
  if (event.k === 'error') { const t = turns.get(sessionId); if (t) t.failed = true }
  if (event.k === 'turn.done') {
    const t = turns.get(sessionId); turns.delete(sessionId)
    if (!t || !t.text || t.failed) return
    const now = new Date(), date = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-')
    try { receiver(cwd, { kind: 'agent.turn.completed', eventId: sessionId+':'+t.id, sessionId, turnId: t.id, projectId: '', text: t.text, originalQuestion: questions.get(sessionId), outcome: 'completed', completedAt: now.toISOString(), date, recorded: t.recorded }) } catch { /* plugin errors cannot interrupt chat */ }
  }
}
