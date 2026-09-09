/** Cancellation spans initialization, live capture and finalization, not just the recording UI. */
export class VoiceRun {
  private generation = 0
  begin(): number { return ++this.generation }
  get token(): number { return this.generation }
  cancel(): void { this.generation++ }
  valid(token: number): boolean { return token === this.generation }
}
