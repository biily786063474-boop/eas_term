/** Trusted main-only entry point. Call only after a successful scoped workbench
 * invocation. No renderer/MCP migration endpoint is exposed; rollback accepts an
 * app-issued identity, never a caller-selected filesystem path. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { migrateCapabilityRegion, rollbackCapabilityMigration } from './capabilityMigration.ts'
import type { MigrationResult } from './capabilityMigration.ts'

const BEGIN = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->'
const END = '<!-- eas-term:end -->'
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export interface CapabilityMigrationServiceOptions {
  appOwnedRoot: string
  homeDirectory: string
  /** Supply agentRules.expectedCodexRegion; never renderer-provided text. */
  expectedRegion: () => string | null
  /** Current preference/opt-out policy, checked again for every attempt. */
  isEnabled: () => boolean
  /** Resolve trust from main's projects/lease ownership, never tool arguments. */
  isTrustedProject: (projectPath: string) => boolean
}
export interface CapabilityMigrationOutcome extends MigrationResult { targetPath: string }
function safePath(path: string, directory: boolean): void {
  if (!isAbsolute(path) || normalize(path) !== path) throw new Error('Unsafe migration service path')
  let current = path, first = true
  for (;;) {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || (first && !directory ? !stat.isFile() : !stat.isDirectory())) throw new Error('Unsafe migration service path')
    const parent = dirname(current)
    if (parent === current) return
    current = parent; first = false
  }
}
function syncDirectory(path: string): void {
  let fd: number | undefined
  try { fd = openSync(path, 'r'); fsyncSync(fd) }
  catch (e) { if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes(String((e as NodeJS.ErrnoException).code))) throw e }
  finally { if (fd !== undefined) closeSync(fd) }
}
export class CapabilityMigrationService {
  private options: CapabilityMigrationServiceOptions
  private directory: string
  private attempted = new Set<string>()
  constructor(options: CapabilityMigrationServiceOptions) {
    this.options = options
    this.directory = join(options.appOwnedRoot, 'capability-migrations')
  }
  private ensureDirectory(): void {
    safePath(this.options.appOwnedRoot, true)
    try { mkdirSync(this.directory, { mode: 0o700 }) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    safePath(this.directory, true)
    syncDirectory(this.options.appOwnedRoot)
  }
  private persist(name: string, value: unknown): void {
    safePath(this.directory, true)
    const fd = openSync(join(this.directory, name), 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd) } finally { closeSync(fd) }
    syncDirectory(this.directory)
  }
  private event(operation: string, value: unknown): void {
    this.persist(randomUUID() + '.event.json', { schemaVersion: 1, at: new Date().toISOString(), operation, value })
  }
  private suppression(target: string): string { return createHash('sha256').update(target).digest('hex') + '.rollback-hold.json' }
  private held(target: string): boolean {
    try { lstatSync(join(this.directory, this.suppression(target))); return true }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e }
  }
  private allowedTarget(target: string): boolean {
    if (target === join(this.options.homeDirectory, '.codex', 'AGENTS.md')) return true
    return ['AGENTS.md', 'CLAUDE.md'].includes(basename(target)) && this.options.isTrustedProject(dirname(target))
  }
  onSuccessfulWorkbenchCall(projectPath?: string): CapabilityMigrationOutcome[] {
    if (!this.options.isEnabled()) return []
    const expected = this.options.expectedRegion()
    if (!expected) return []
    this.ensureDirectory()
    const targets = [join(this.options.homeDirectory, '.codex', 'AGENTS.md')]
    if (projectPath && this.options.isTrustedProject(projectPath)) targets.push(join(projectPath, 'AGENTS.md'), join(projectPath, 'CLAUDE.md'))
    const outcomes: CapabilityMigrationOutcome[] = []
    for (const targetPath of new Set(targets)) {
      if (!this.options.isEnabled()) break
      if (this.attempted.has(targetPath) || this.held(targetPath)) continue
      // Durable intent precedes all target mutation; helper persists full original
      // bytes and its own manifest before the atomic replacement.
      this.event('migration-intent', { targetPath })
      let result: MigrationResult
      try {
        result = migrateCapabilityRegion({ backupDirectory: this.directory, targetPath, beginMarker: BEGIN, endMarker: END, ownedRegions: [expected], newRegion: '', healthy: true })
      } catch (e) {
        result = { status: 'deferred', reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'target-missing' : 'migration-unavailable' }
      }
      const outcome = { targetPath, ...result }
      this.event('migration-result', outcome)
      this.attempted.add(targetPath)
      outcomes.push(outcome)
    }
    return outcomes
  }
  rollback(migrationId: string): MigrationResult {
    if (!ID.test(migrationId)) throw new Error('Invalid migration identity')
    this.ensureDirectory()
    const manifestPath = join(this.directory, migrationId + '.json')
    safePath(manifestPath, false)
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const targetPath = (manifest as { targetPath?: unknown })?.targetPath
    if (typeof targetPath !== 'string' || !this.allowedTarget(targetPath)) throw new Error('Untrusted rollback target')
    // Persist user rollback intent first. Even a crash/conflict must not cause a
    // later successful tool call to automatically remove the restored rules.
    if (!this.held(targetPath)) this.persist(this.suppression(targetPath), { schemaVersion: 1, targetPath, migrationId })
    this.event('rollback-intent', { migrationId, targetPath })
    const result = rollbackCapabilityMigration({ backupDirectory: this.directory, targetPath, migrationId })
    this.event('rollback-result', { ...result, targetPath })
    return result
  }
}
