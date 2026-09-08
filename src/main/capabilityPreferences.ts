/** Electron-free trusted host helpers. Paths are supplied by application code,
 * never plugin/renderer arguments. This module never executes bundle commands. */
import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import type { CapabilityBundle, CapabilityModule, CapabilityPreferences, CapabilityPreferenceSnapshot } from '../shared/builtinCapabilities.ts'

const modules: CapabilityModule[] = ['workbench', 'bizone', 'guidance']
const closed = (): CapabilityPreferenceSnapshot => ({ preferences: { workbench: false, bizone: false, guidance: false }, error: 'capability-preferences-unavailable' })
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) }

export function parseCapabilityBundle(value: unknown): CapabilityBundle {
  const fail = (): never => { throw new Error('Invalid builtin capability bundle') }
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'id', 'version', 'displayName', 'modules']) ||
    value.schemaVersion !== 1 || value.id !== 'eas-capabilities' || typeof value.version !== 'string' || !value.version.trim() ||
    typeof value.displayName !== 'string' || !value.displayName.trim() || !Array.isArray(value.modules) || value.modules.length !== 3) return fail()
  const seen = new Set<string>()
  for (const module of value.modules) {
    if (!object(module) || typeof module.id !== 'string' || seen.has(module.id)) return fail()
    seen.add(module.id)
    if (module.id === 'guidance') {
      if (!exactKeys(module, ['id', 'binding']) || module.binding !== 'managed-session-instructions') return fail()
    } else if (module.id === 'workbench' || module.id === 'bizone') {
      if (!exactKeys(module, ['id', 'binding', 'serverName']) || module.binding !== (module.id === 'workbench' ? 'workbench-gateway' : 'bizone-connector') ||
        module.serverName !== (module.id === 'workbench' ? 'eas-term' : 'bizone-canvas')) return fail()
    } else return fail()
  }
  return structuredClone(value) as unknown as CapabilityBundle
}
/** filePath must be the host-resolved packaged resources/plugins/eas-capabilities/bundle.json. */
export function readCapabilityBundle(filePath: string): CapabilityBundle {
  return parseCapabilityBundle(JSON.parse(readFileSync(filePath, 'utf8')))
}

export class CapabilityPreferenceStore {
  private root: string
  private path: string
  private failed = false
  constructor(appOwnedRoot: string, legacy: { legacyMcpOptOut?: boolean; legacyGuidanceMuted?: boolean } = {}) {
    this.root = appOwnedRoot
    this.path = join(appOwnedRoot, 'capability-preferences.json')
    try {
      this.checkRoot()
      try { lstatSync(this.path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        // legacyGuidanceMuted is a caller policy decision: old prompt hiding alone
        // does not establish that the user disabled the guidance capability.
        this.write({ workbench: legacy.legacyMcpOptOut !== true, bizone: legacy.legacyMcpOptOut !== true, guidance: legacy.legacyGuidanceMuted !== true })
      }
    } catch { this.failed = true }
  }
  read(): CapabilityPreferenceSnapshot {
    if (this.failed) return closed()
    try {
      this.checkRoot()
      const stat = lstatSync(this.path)
      if (!stat.isFile() || stat.isSymbolicLink()) return closed()
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!object(value) || value.schemaVersion !== 1 || modules.some(module => typeof value[module] !== 'boolean')) return closed()
      return { preferences: { workbench: value.workbench as boolean, bizone: value.bizone as boolean, guidance: value.guidance as boolean } }
    } catch { return closed() }
  }
  set(module: CapabilityModule, enabled: boolean): CapabilityPreferenceSnapshot {
    if (!modules.includes(module) || typeof enabled !== 'boolean') throw new Error('Invalid capability preference')
    const current = this.read()
    if (current.error || current.preferences[module] === enabled) return current
    const preferences = { ...current.preferences, [module]: enabled }
    try { this.write(preferences); return { preferences } } catch { this.failed = true; return closed() }
  }
  private checkRoot(): void {
    if (!isAbsolute(this.root) || normalize(this.root) !== this.root) throw new Error('Invalid app-owned preference root')
    const stat = lstatSync(this.root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe preference root')
  }
  private write(preferences: CapabilityPreferences): void {
    this.checkRoot()
    const temporary = join(this.root, 'capability-preferences-' + randomUUID() + '.tmp')
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify({ schemaVersion: 1, ...preferences }))
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(temporary, this.path)
    } finally {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(temporary) } catch { /* renamed or absent */ }
    }
  }
}
