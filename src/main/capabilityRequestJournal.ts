/** Main-process-only ledger. Constructor directory must come from app.getPath('userData'),
 * never an RPC argument. One Electron instance owns this directory. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export interface JournalOperation {
  scope: string
  project: string
  tool: string
  nodeId?: string
  taskId?: string
  arguments: unknown
}
type State = 'submitting' | 'unknown' | 'completed'
interface Entry { id: string; digest: string; state: State; nodeId?: string; taskId?: string; result?: unknown }
export type JournalDecision = { action: 'submit'; state: 'submitting' } |
  { action: 'blocked'; state: 'submitting' | 'unknown' } |
  { action: 'cached'; state: 'completed'; result: unknown }

function stable(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Journal requires finite, acyclic JSON')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return '[' + Array.from(value, item => stable(item, ancestors)).join(',') + ']'
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Journal requires plain JSON')
    const record = value as Record<string, unknown>
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + stable(record[key], ancestors)).join(',') + '}'
  } finally { ancestors.delete(value) }
}
function digest(operation: JournalOperation): string {
  for (const value of [operation.scope, operation.project, operation.tool]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Journal operation identity required')
  }
  for (const value of [operation.nodeId, operation.taskId]) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new Error('Journal node/task identity invalid')
  }
  return createHash('sha256').update(stable({ scope: operation.scope, project: operation.project,
    tool: operation.tool, nodeId: operation.nodeId ?? null, taskId: operation.taskId ?? null,
    arguments: operation.arguments })).digest('hex')
}
function resultJson(result: unknown): unknown {
  const json = stable(result)
  if (/"(?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|secret)"\s*:/i.test(json)) {
    throw new Error('Journal result contains secret fields')
  }
  return JSON.parse(json)
}
function assertRegular(path: string, directory = false): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('Unsafe journal path')
}

export function isUnsupportedDirectorySync(error: unknown, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && error !== null && typeof error === 'object' &&
    ['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes(String((error as NodeJS.ErrnoException).code))
}

function syncDirectory(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch (error) {
    // File fsync and atomic rename still protect process-crash recovery. Windows
    // cannot promise directory metadata durability across power loss here.
    if (!isUnsupportedDirectorySync(error, process.platform)) throw error
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export class RequestJournal {
  private directory: string
  private path: string
  private failed = false
  private seenJournal = false

  constructor(appOwnedDataDir: string) {
    if (!isAbsolute(appOwnedDataDir)) throw new Error('Journal requires app-owned absolute data directory')
    assertRegular(appOwnedDataDir, true)
    this.directory = join(appOwnedDataDir, 'capability-requests')
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    assertRegular(this.directory, true)
    syncDirectory(appOwnedDataDir)
    this.path = join(this.directory, 'journal.json')
    const entries = this.read()
    if (entries.some(entry => entry.state === 'submitting')) {
      this.persist(entries.map(entry => entry.state === 'submitting' ? { ...entry, state: 'unknown' } : entry))
    }
  }

  begin(id: string, operation: JournalOperation): JournalDecision {
    const entries = this.read()
    const hash = digest(operation)
    const existing = this.match(entries, id, hash)
    if (existing) {
      if (existing.state === 'completed') return { action: 'cached', state: 'completed', result: existing.result }
      return { action: 'blocked', state: existing.state }
    }
    entries.push({ id, digest: hash, state: 'submitting',
      ...(operation.nodeId === undefined ? {} : { nodeId: operation.nodeId }),
      ...(operation.taskId === undefined ? {} : { taskId: operation.taskId }) })
    this.persist(entries) // File + directory fsync precede permission to dispatch.
    return { action: 'submit', state: 'submitting' }
  }

  complete(id: string, operation: JournalOperation, result: unknown): void {
    this.finish(id, operation, result, false)
  }

  /** Only call with trustworthy server evidence matching this operation.
   * Connection recovery alone is never evidence. No automatic retries exist. */
  reconcile(id: string, operation: JournalOperation, reliableResult: unknown): void {
    this.finish(id, operation, reliableResult, true)
  }

  markUnknown(id: string, operation: JournalOperation): void {
    const entries = this.read()
    const entry = this.match(entries, id, digest(operation))
    if (!entry) throw new Error('Journal operation missing')
    if (entry.state === 'completed') return
    entry.state = 'unknown'
    this.persist(entries)
  }

  private finish(id: string, operation: JournalOperation, result: unknown, reconciliation: boolean): void {
    const cleanResult = resultJson(result)
    const entries = this.read()
    const entry = this.match(entries, id, digest(operation))
    if (!entry) throw new Error('Journal operation missing')
    if (entry.state === 'completed') {
      if (stable(entry.result) !== stable(cleanResult)) throw new Error('Journal completed result mismatch')
      return
    }
    if (entry.state === 'unknown' && !reconciliation) throw new Error('Journal unknown operation requires reconciliation')
    entry.state = 'completed'
    entry.result = cleanResult
    this.persist(entries)
  }

  private match(entries: Entry[], id: string, hash: string): Entry | undefined {
    if (typeof id !== 'string' || !id.trim() || id.length > 512) throw new Error('Journal logical operation ID required')
    const entry = entries.find(item => item.id === id)
    if (entry && entry.digest !== hash) throw new Error('Journal operation parameters mismatch')
    return entry
  }

  private read(): Entry[] {
    if (this.failed) throw new Error('Journal unavailable after persistence failure')
    try {
      assertRegular(this.directory, true)
      try { assertRegular(this.path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.seenJournal) return []
        throw error
      }
      const data = JSON.parse(readFileSync(this.path, 'utf8'))
      this.seenJournal = true
      if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('Invalid schema')
      const ids = new Set<string>()
      for (const entry of data.entries) {
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id) ||
            typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest) ||
            !['submitting', 'unknown', 'completed'].includes(entry.state) ||
            Object.keys(entry).some(key => !['id', 'digest', 'state', 'nodeId', 'taskId', 'result'].includes(key)) ||
            [entry.nodeId, entry.taskId].some(value => value !== undefined && (typeof value !== 'string' || !value.trim())) ||
            (entry.state === 'completed' ? !Object.hasOwn(entry, 'result') : Object.hasOwn(entry, 'result'))) throw new Error('Invalid entry')
        if (entry.state === 'completed') resultJson(entry.result)
        ids.add(entry.id)
      }
      return data.entries
    } catch {
      this.failed = true
      throw new Error('Journal unreadable or corrupt; paid submissions blocked')
    }
  }

  private persist(entries: Entry[]): void {
    const temporary = join(this.directory, 'journal-' + randomUUID() + '.tmp')
    let fd: number | undefined
    try {
      assertRegular(this.directory, true)
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify({ version: 1, entries }))
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(temporary, this.path)
      this.seenJournal = true
      syncDirectory(this.directory)
    } catch {
      this.failed = true
      throw new Error('Journal persistence failed; paid submissions blocked')
    } finally {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(temporary) } catch { /* renamed or absent */ }
    }
  }
}
