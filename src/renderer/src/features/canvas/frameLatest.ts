/** Coalesce absolute pointer positions, never sum them or defer past gesture end. */
export function frameLatest<T>(commit: (value: T) => void, request: (cb: () => void) => number, cancelFrame: (id: number) => void) {
  let frame: number | undefined
  let pending: { value: T } | undefined
  const flush = (): void => {
    if (frame !== undefined) cancelFrame(frame)
    frame = undefined
    const value = pending
    pending = undefined
    if (value) commit(value.value)
  }
  return {
    push(value: T): void {
      pending = { value }
      if (frame === undefined) frame = request(() => { frame = undefined; flush() })
    },
    flush,
    cancel(): void {
      if (frame !== undefined) cancelFrame(frame)
      frame = undefined
      pending = undefined
    }
  }
}
