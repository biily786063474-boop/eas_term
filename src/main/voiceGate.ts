/** Bounded audio gate. Detection is supplied by VAD, never inferred from amplitude. */
export class VoiceGate {
  private before: Float32Array[] = []
  private tail = 0
  private readonly preFrames: number
  private readonly tailFrames: number
  constructor(preFrames = 2, tailFrames = 6) { this.preFrames = preFrames; this.tailFrames = tailFrames }
  reset(): void { this.before = []; this.tail = 0 }
  push(frame: Float32Array, speech: boolean): Float32Array[] {
    if (speech) {
      this.tail = this.tailFrames
      const frames = [...this.before, frame]
      this.before = []
      return frames
    }
    if (this.tail > 0) { this.tail--; return [frame] }
    this.before.push(frame)
    if (this.before.length > this.preFrames) this.before.shift()
    return []
  }
}
