// Electron-free sink: pure launch modules can keep their existing bare-node tests.
let sink: ((kind: string, data: Record<string, unknown>) => void) | undefined
export function setDiagnosticSink(next: typeof sink): void { sink = next }
export function recordDiagnostic(kind: string, data: Record<string, unknown> = {}): void {
  try { sink?.(kind, data) } catch { /* diagnostics must not change process lifecycle */ }
}
