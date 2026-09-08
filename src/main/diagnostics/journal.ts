import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeEvent, type SafeEvent } from './core.ts'
export class Journal {
  private dir: string
  private cap: number
  private started = Date.now()
  private run = randomUUID()
  constructor(dir: string, cap = 7 * 1024 * 1024) { this.dir = dir; this.cap = cap }
  start(): boolean {
    let unclean = false
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      unclean = fs.existsSync(path.join(this.dir, 'running'))
      fs.writeFileSync(path.join(this.dir, 'running'), '1', { mode: 0o600 })
    } catch { /* diagnostics never breaks launch */ }
    this.record('app-start', {})
    if (unclean) this.record('previous-unclean', {})
    return unclean
  }
  finish(): void {
    this.record('app-quit', {})
    try { fs.unlinkSync(path.join(this.dir, 'running')) } catch { /* best effort */ }
  }
  record(kind: string, data: Record<string, unknown> = {}): void {
    try {
      const event = safeEvent(kind, { ...data, run: this.run }, Date.now() - this.started)
      if (!event) return
      const line = JSON.stringify(event) + '\n'
      const file = path.join(this.dir, 'events.jsonl')
      const max = Math.floor((this.cap - 1024) / 2)
      if (Buffer.byteLength(line) > max) return
      if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > max) {
        const old = path.join(this.dir, 'previous.jsonl')
        fs.rmSync(old, { force: true }); fs.renameSync(file, old)
      }
      fs.appendFileSync(file, line, { mode: 0o600 })
    } catch { /* disk full, invalid permissions, malformed error: no effect on app */ }
  }
  events(): SafeEvent[] {
    const rows: SafeEvent[] = []
    for (const name of ['previous.jsonl', 'events.jsonl']) {
      try {
        const f = path.join(this.dir, name)
        if (fs.statSync(f).size > this.cap) continue
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          try { const d = JSON.parse(line); const e = safeEvent(d.kind, d, d.t); if (e) rows.push(e) } catch { /* incomplete last write */ }
        }
      } catch { /* absent */ }
    }
    return rows.slice(-1500)
  }
}
