/** Per-chat pending messages. The transport's terminal event, not rendered text or a timer, releases the next message. */
export interface QueuedMessage {
  /** Assigned by the per-session queue, stable across explicit retries. */
  id?: number
  text: string
  meta?: { text: string; images: { path: string; url: string }[] }
}
export interface QueueItem extends QueuedMessage { id: number }
export interface QueueSnapshot { items: QueueItem[]; paused: boolean; interrupting: boolean; sendingId: number | null }
export function createMessageQueue(deps: {
  busy: () => boolean
  send: (item: QueuedMessage) => Promise<boolean>
  interrupt: () => void
  changed: () => void
}) {
  let items: QueueItem[] = [], serial = 0, disposed = false, waiting = false
  let paused = false, redirect = false, interrupting = false, inFlight = false, sendingId: number | null = null
  let active: { item: QueueItem; queued: boolean; failed: boolean } | null = null
  const changed = (): void => { if (!disposed) deps.changed() }
  const schedule = (): void => { queueMicrotask(() => { if (!disposed) pump() }) }
  const snapshot = (): QueueSnapshot => ({ items: [...items], paused, interrupting, sendingId })
  const dispatch = async (item: QueueItem, queued: boolean): Promise<boolean> => {
    const attempt = { item, queued, failed: false }
    active = attempt
    inFlight = true; waiting = true; sendingId = item.id; changed()
    let ok = false
    try { ok = await deps.send(item) } catch { /* Retain the message; the owner reports the transport error. */ }
    if (disposed) return ok
    inFlight = false; sendingId = null
    if (ok && !attempt.failed) { if (queued) items = items.filter(i => i.id !== item.id); if (!items.length) paused = false }
    else { waiting = false; if (queued || items.length) paused = true }
    changed(); schedule()
    return ok
  }
  const pump = (): void => {
    if (disposed || inFlight || interrupting || !items.length || paused) return
    if (redirect && (waiting || deps.busy())) {
      interrupting = true; changed()
      try { deps.interrupt() } catch { interrupting = false; paused = true; changed() }
      return
    }
    if (waiting || deps.busy()) return
    redirect = false
    void dispatch(items[0], true)
  }
  return {
    snapshot,
    async submit(message: QueuedMessage, mode: 'queue' | 'redirect' = 'queue'): Promise<boolean> {
      if (disposed || !message.text.trim()) return false
      const item = { ...message, id: ++serial }
      if (mode === 'queue' && !inFlight && !waiting && !deps.busy() && !items.length) { paused = false; return dispatch(item, false) }
      if (mode === 'redirect') { items.unshift(item); redirect = true; paused = false }
      else items.push(item)
      changed(); schedule(); return true
    },
    event(kind: 'turn.start' | 'turn.done' | 'fatal'): void {
      if (disposed) return
      if (kind === 'turn.start') waiting = true
      else {
        waiting = false; interrupting = false
        if (kind === 'fatal') {
          if (active) {
            active.failed = true
            const failedItem = active.item
            if (active.queued && !items.some(i => i.id === failedItem.id)) items.unshift(failedItem)
            active = null
          }
          paused = items.length > 0
        } else active = null
        changed(); schedule()
      }
    },
    remove(id: number): void {
      if (id === sendingId) return
      items = items.filter(i => i.id !== id)
      if (!items.length) { paused = false; redirect = false }
      changed()
    },
    steer(id: number): void {
      const item = items.find(i => i.id === id)
      if (!item || id === sendingId) return
      items = [item, ...items.filter(i => i.id !== id)]; redirect = true; paused = false; changed(); schedule()
    },
    pause(): void { paused = true; redirect = false; changed() },
    retry(): void { paused = false; changed(); schedule() },
    dispose(): void { disposed = true; items = []; active = null }
  }
}
