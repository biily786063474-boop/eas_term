import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Caller validates the history key and private root. Empty snapshots never delete history. */
export function writeHistorySnapshot(file: string, snapshot: { turns: unknown[]; [key: string]: unknown }): boolean {
  if (!snapshot.turns.length) return false
  const data = JSON.stringify(snapshot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = file + '.' + randomUUID() + '.tmp'
  let fd: number | undefined
  try {
    fd = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(fd, data, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temporary, file)
    return true
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    // Only our unique temporary file, never the committed snapshot.
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}
