/** A segment's destination is immutable even when focus changes while ASR is running. */
export class VoiceRouter {
  private targets = new Map<string, (text: string) => void | boolean>()
  private seen = new Set<string>()
  current = ''
  register(id: string, insert: (text: string) => void | boolean): () => void {
    this.targets.set(id, insert)
    return () => { if (this.targets.get(id) !== insert) return; this.targets.delete(id); if (this.current === id) this.current = '' }
  }
  hasDelivered(segmentId: string): boolean { return this.seen.has(segmentId) }
  focus(id: string): void { this.current = this.targets.has(id) ? id : '' }
  deliver(id: string, text: string, segmentId?: string): boolean {
    const insert = this.targets.get(id)
    if (!insert || !text || (segmentId && this.seen.has(segmentId))) return false
    if (insert(text) === false) return false
    if (segmentId) { this.seen.add(segmentId); if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!) }
    return true
  }
}
export const voiceRouter = new VoiceRouter()
