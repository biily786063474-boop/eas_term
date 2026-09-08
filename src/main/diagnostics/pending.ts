import fs from 'node:fs'
import path from 'node:path'
import { makeReport, encodeReport, MAX_RAW, type Report } from './core.ts'
const file = (dir: string): string => path.join(dir, 'diagnostic-pending.json')
export function savePending(dir: string, report: Report): void {
  encodeReport(report)
  const tmp = file(dir) + '.tmp'
  const fd = fs.openSync(tmp, 'w', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(report)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file(dir))
}
export function loadPending(dir: string): Report | undefined {
  try {
    if (fs.statSync(file(dir)).size > MAX_RAW) return undefined
    const r = JSON.parse(fs.readFileSync(file(dir), 'utf8'))
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.id)) return undefined
    const clean = { ...makeReport(r, r.events), id: r.id }
    if (JSON.stringify(clean) !== JSON.stringify(r)) return undefined
    encodeReport(clean)
    return clean
  } catch { return undefined }
}
export function clearPending(dir: string): void { try { fs.rmSync(file(dir), { force: true }) } catch { /* safe identical retry if old remains */ } }
