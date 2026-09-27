/** Renderer-local save acknowledgements. A checkpoint is NOT authority to reload:
 * main must independently gate admission and prove every mounted module covered. */
export interface RecoveryParticipant {
  flush: () => Promise<boolean>
  ready: () => boolean
}
export interface RecoveryCheckpoint { readonly generation: number }
export function createRecoveryRegistry() {
  const participants = new Map<string, RecoveryParticipant>()
  const issued = new WeakSet<RecoveryCheckpoint>()
  let generation = 0
  let preparing = false
  const safe = (): boolean => {
    try { return [...participants.values()].every(p => p.ready() === true) }
    catch { return false }
  }
  return {
    changed() { generation++ },
    register(id: string, participant: RecoveryParticipant) {
      if (!id || participants.has(id)) throw Error('duplicate or empty recovery participant')
      participants.set(id, participant); generation++
      return () => {
        if (participants.get(id) === participant) { participants.delete(id); generation++ }
      }
    },
    current(token: RecoveryCheckpoint): boolean {
      return issued.has(token) && token.generation === generation && safe()
    },
    async prepare(required: readonly string[], timeoutMs = 5000): Promise<RecoveryCheckpoint | null> {
      if (preparing || !required.length || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
          required.some(id => !participants.has(id)) || !safe()) return null
      preparing = true
      const start = generation
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const saved = await Promise.race([
          Promise.all([...participants.values()].map(p => Promise.resolve().then(() => p.flush())))
            .then(results => results.every(result => result === true)),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })
        ])
        if (!saved || start !== generation || !safe()) return null
        const token = Object.freeze({generation: start})
        issued.add(token)
        return token
      } catch { return null }
      finally { clearTimeout(timer); preparing = false }
    }
  }
}
