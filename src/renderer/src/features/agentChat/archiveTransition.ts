/** A per-module gate. Only commit may clear UI or change conversation identity.
 * stop must acknowledge session quiescence; the legacy fire-and-forget IPC does NOT
 * meet that contract. save must read the latest snapshot on each invocation.
 */
export function createArchiveTransition(): {
  run: (steps: {
    save: () => Promise<boolean>
    stop: () => Promise<void>
    commit: () => void
    isCurrent?: () => boolean
  }) => Promise<'switched' | 'busy' | 'stale' | 'save-failed' | 'stop-failed'>
} {
  let busy = false
  return {
    async run(steps) {
      if (busy) return 'busy'
      busy = true
      const current = (): boolean => steps.isCurrent?.() ?? true
      const save = async (): Promise<boolean> => {
        try { return await steps.save() } catch { return false }
      }
      try {
        if (!current()) return 'stale'
        if (!await save()) return 'save-failed'
        if (!current()) return 'stale'
        try { await steps.stop() } catch { return 'stop-failed' }
        if (!current()) return 'stale'
        if (!await save()) return 'save-failed'
        if (!current()) return 'stale'
        steps.commit()
        return 'switched'
      } finally {
        busy = false
      }
    }
  }
}
