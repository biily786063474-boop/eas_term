/** Trusted main-process compiler for OMP's standard Agent Plugins discovery.
 * No lease/token is serialized: the local runner inherits its managed CLI lease.
 * OMP starts it in the plugin directory; actual tool cwd/Frame comes from the lease.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, fchmodSync } from 'node:fs'
import { isAbsolute, join, win32 } from 'node:path'
import type { NodeRunner } from './nodeBin.ts'

export interface OmpCapabilityPluginOptions {
  /** Application-controlled existing userData root, never an IPC/plugin argument. */
  appOwnedRoot: string
  /** From nodeRunner([absolute eas-capability-shim path]); no credential args. */
  runner: NodeRunner
  enabled: { workbench: boolean; bizone: boolean }
  version: string
  platform?: NodeJS.Platform
}
export interface OmpCapabilityPlugin {
  root: string
  extensionArgs: ['-e', string]
  serverNames: { workbench?: 'eas-capabilities:eas-term'; bizone?: 'eas-capabilities:bizone-canvas' }
}
function regular(path: string, directory = false): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('Unsafe OMP capability path')
}
function quotePosix(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'" }
function quoteWindows(value: string): string {
  if (value.includes('"')) throw new Error('Unsupported quote in Windows runner argument')
  return '"' + value.replace(/%/g, '%%') + '"'
}

export function createOmpCapabilityPlugin(options: OmpCapabilityPluginOptions): OmpCapabilityPlugin | null {
  if (typeof options.enabled.workbench !== 'boolean' || typeof options.enabled.bizone !== 'boolean') throw new Error('Invalid OMP module preference')
  if (!options.enabled.workbench && !options.enabled.bizone) return null
  const windows = (options.platform ?? process.platform) === 'win32'
  if (!isAbsolute(options.appOwnedRoot) || !(windows ? win32.isAbsolute(options.runner.command) : isAbsolute(options.runner.command))) throw new Error('OMP host paths must be absolute')
  regular(options.appOwnedRoot, true)
  if (typeof options.version !== 'string' || !options.version.trim()) throw new Error('Invalid OMP plugin version')
  for (const value of [options.runner.command, ...options.runner.args]) {
    if (typeof value !== 'string' || /[\0\r\n]/.test(value)) throw new Error('Invalid OMP runner argument')
  }
  const runnerEnv = options.runner.env ?? {}
  if (Object.entries(runnerEnv).some(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' || value !== '1')) throw new Error('Unsupported runner environment; credentials must remain in the managed process')
  const runnerName = windows ? 'runner.cmd' : 'runner'
  const command = [options.runner.command, ...options.runner.args].map(windows ? quoteWindows : quotePosix).join(' ')
  const script = windows ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\n' + command + '\r\nexit /b %errorlevel%\r\n' : '#!/bin/sh\nexec ' + command + '\n'
  const servers: Record<string, unknown> = {}
  const serverNames: OmpCapabilityPlugin['serverNames'] = {}
  for (const [module, name] of [['workbench', 'eas-term'], ['bizone', 'bizone-canvas']] as const) {
    if (!options.enabled[module]) continue
    servers[name] = { type: 'stdio', command: './' + runnerName, env: { ...runnerEnv, EAS_CAPABILITY_MODULE: module } }
    if (module === 'workbench') serverNames.workbench = 'eas-capabilities:eas-term'
    else serverNames.bizone = 'eas-capabilities:bizone-canvas'
  }
  const files: Record<string, string> = {
    'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'eas-capabilities', version: options.version }),
    'mcp.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: servers }),
    [runnerName]: script
  }
  const parent = join(options.appOwnedRoot, 'omp-capability-plugins')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  regular(parent, true)
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  const root = join(parent, digest)
  let exists = true
  try { regular(root, true) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false
    else throw error
  }
  if (exists) {
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, name)
      regular(path)
      if (readFileSync(path, 'utf8') !== content) throw new Error('OMP capability snapshot was modified')
    }
  } else {
    const temporary = join(parent, '.tmp-' + randomUUID())
    mkdirSync(temporary, { mode: 0o700 })
    try {
      for (const [name, content] of Object.entries(files)) {
        const fd = openSync(join(temporary, name), 'wx', 0o600)
        try {
          writeFileSync(fd, content)
          fchmodSync(fd, name === runnerName ? 0o500 : 0o400)
          fsyncSync(fd)
        } finally { closeSync(fd) }
      }
      renameSync(temporary, root)
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  }
  return { root, extensionArgs: ['-e', root], serverNames }
}
