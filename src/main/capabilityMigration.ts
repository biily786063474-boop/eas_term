/** Trusted main-process migration helper. Paths/ownership evidence come exclusively
 * from application code, never renderer/MCP input. Does not run on import. Injection
 * files deliberately do not use fsGuard; see architecture 03 injection exception. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fchmodSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'

export interface CapabilityMigrationOptions {
  backupDirectory: string
  targetPath: string
  beginMarker: string
  endMarker: string
  /** Exact region includes both marker strings; no whitespace normalization. */
  ownedRegions?: readonly string[]
  ownedRegionHashes?: readonly string[]
  /** Entire replacement region including fences, or empty string for deletion. */
  newRegion: string
  healthy: boolean
}
export interface MigrationResult {
  status: 'migrated' | 'restored' | 'noop' | 'conflict' | 'deferred'
  migrationId?: string
  reason?: string
}
interface Manifest { version: 1; targetPath: string; beforeHash: string; afterHash: string; mode: number }
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

function checkPath(path: string, directory: boolean): void {
  if (!isAbsolute(path) || normalize(path) !== path) throw new Error('Migration requires canonical absolute paths')
  let current = path
  let first = true
  for (;;) {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || (first && !directory ? !stat.isFile() : !stat.isDirectory())) throw new Error('Unsafe migration path')
    const parent = dirname(current)
    if (parent === current) break
    current = parent
    first = false
  }
}
function regionBounds(text: string, begin: string, end: string): [number, number] | 'missing' | 'invalid' {
  if (!begin || !end || begin === end || begin.includes(end) || end.includes(begin)) return 'invalid'
  const start = text.indexOf(begin)
  const finish = text.indexOf(end)
  if (start === -1 && finish === -1) return 'missing'
  if (start === -1 || finish < start + begin.length || text.indexOf(begin, start + begin.length) !== -1 || text.indexOf(end, finish + end.length) !== -1) return 'invalid'
  return [start, finish + end.length]
}
function syncDirectory(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch (error) {
    // Windows directory metadata fsync is not universally available. File fsync
    // remains mandatory; power-loss durability is not claimed on that platform.
    if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes(String((error as NodeJS.ErrnoException).code))) throw error
  } finally { if (fd !== undefined) closeSync(fd) }
}
function writeExclusive(path: string, bytes: Buffer | string): void {
  const fd = openSync(path, 'wx', 0o600)
  try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
}
/** Rechecks original bytes immediately before rename. Atomic replacement also
 * handles existing chmod 444 managed rules without changing their permissions. */
function replaceIfUnchanged(path: string, expectedHash: string, bytes: Buffer, mode: number): boolean {
  checkPath(path, false)
  const temporary = join(dirname(path), '.capability-migration-' + randomUUID() + '.tmp')
  try {
    writeExclusive(temporary, bytes)
    const fd = openSync(temporary, 'r+')
    try { fchmodSync(fd, mode); fsyncSync(fd) } finally { closeSync(fd) }
    checkPath(path, false)
    if (hash(readFileSync(path)) !== expectedHash) return false
    renameSync(temporary, path)
    syncDirectory(dirname(path))
    return true
  } finally { try { unlinkSync(temporary) } catch { /* renamed or absent */ } }
}

export function migrateCapabilityRegion(options: CapabilityMigrationOptions): MigrationResult {
  if (options.healthy !== true) return { status: 'deferred', reason: 'new-link-unhealthy' }
  checkPath(options.targetPath, false)
  const original = readFileSync(options.targetPath)
  const text = original.toString('utf8')
  if (!Buffer.from(text).equals(original)) return { status: 'conflict', reason: 'non-utf8' }
  const bounds = regionBounds(text, options.beginMarker, options.endMarker)
  if (bounds === 'missing') return { status: 'noop', reason: 'no-managed-region' }
  if (bounds === 'invalid') return { status: 'conflict', reason: 'invalid-markers' }
  if (options.newRegion) {
    const replacement = regionBounds(options.newRegion, options.beginMarker, options.endMarker)
    if (!Array.isArray(replacement) || replacement[0] !== 0 || replacement[1] !== options.newRegion.length) return { status: 'conflict', reason: 'invalid-replacement' }
  }
  const old = text.slice(bounds[0], bounds[1])
  if (old === options.newRegion) return { status: 'noop', reason: 'already-current' }
  if (!options.ownedRegions?.includes(old) && !options.ownedRegionHashes?.includes(hash(old))) return { status: 'conflict', reason: 'ownership-unproven' }
  const updated = Buffer.from(text.slice(0, bounds[0]) + options.newRegion + text.slice(bounds[1]))
  checkPath(options.backupDirectory, true)
  const migrationId = randomUUID()
  const manifest: Manifest = { version: 1, targetPath: options.targetPath, beforeHash: hash(original), afterHash: hash(updated), mode: lstatSync(options.targetPath).mode & 0o777 }
  // Backup and metadata must both exist durably before touching the target.
  writeExclusive(join(options.backupDirectory, migrationId + '.bak'), original)
  writeExclusive(join(options.backupDirectory, migrationId + '.json'), JSON.stringify(manifest))
  syncDirectory(options.backupDirectory)
  if (!replaceIfUnchanged(options.targetPath, manifest.beforeHash, updated, manifest.mode)) return { status: 'conflict', reason: 'target-changed', migrationId }
  return { status: 'migrated', migrationId }
}

export function rollbackCapabilityMigration(options: { backupDirectory: string; targetPath: string; migrationId: string }): MigrationResult {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(options.migrationId)) throw new Error('Invalid migration identity')
  checkPath(options.backupDirectory, true)
  checkPath(options.targetPath, false)
  const manifestPath = join(options.backupDirectory, options.migrationId + '.json')
  const backupPath = join(options.backupDirectory, options.migrationId + '.bak')
  checkPath(manifestPath, false)
  checkPath(backupPath, false)
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== 1 || manifest.targetPath !== options.targetPath ||
    !/^[a-f0-9]{64}$/.test(manifest.beforeHash) || !/^[a-f0-9]{64}$/.test(manifest.afterHash) ||
    !Number.isInteger(manifest.mode) || manifest.mode < 0 || manifest.mode > 0o777) throw new Error('Invalid migration manifest')
  const backup = readFileSync(backupPath)
  if (hash(backup) !== manifest.beforeHash) return { status: 'conflict', reason: 'backup-corrupt' }
  const current = hash(readFileSync(options.targetPath))
  if (current === manifest.beforeHash) return { status: 'noop', reason: 'already-restored' }
  if (current !== manifest.afterHash) return { status: 'conflict', reason: 'target-changed' }
  if (!replaceIfUnchanged(options.targetPath, manifest.afterHash, backup, manifest.mode)) return { status: 'conflict', reason: 'target-changed' }
  return { status: 'restored', migrationId: options.migrationId }
}
