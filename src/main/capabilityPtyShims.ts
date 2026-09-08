/** App-owned PATH entries only. No shell/alias files or CLI user configuration are
 * changed here. PTY wiring controls PATH precedence and owns the parent lease. */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { nodeRunner, type NodeRunner } from './nodeBin.ts'

const KINDS = ['claude', 'codex', 'omp'] as const
type CliKind = typeof KINDS[number]
interface ShimHost { userData: string; appPath: string; resourcesPath: string; isPackaged: boolean }
interface ShimOptions { electron?: string; platform?: NodeJS.Platform; exists?: (path: string) => boolean }
function posixLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('Invalid shim argument')
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
function cmdLiteral(value: string): string {
  // Quotes/control characters cannot be made safe by wrapping in cmd quotes.
  // Percent expansion still occurs inside quotes; ! stays literal with delayed
  // expansion disabled. Do not use CALL, which would expand these values again.
  if (/["\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid Windows shim argument')
  return '"' + value.replaceAll('%', '%%') + '"'
}
export function renderCapabilityPtyShim(kind: CliKind, runner: NodeRunner, platform: NodeJS.Platform): string {
  if (!KINDS.includes(kind)) throw new Error('Unsupported capability CLI')
  const fallback = runner.env?.ELECTRON_RUN_AS_NODE === '1'
  if (Object.keys(runner.env ?? {}).some(key => key !== 'ELECTRON_RUN_AS_NODE')) throw new Error('Unsupported shim environment')
  if (platform === 'win32') {
    const invocation = [runner.command, ...runner.args, kind].map(cmdLiteral).join(' ')
    return [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      'set "_EAS_CAPABILITY_CP="',
      'for /f "tokens=2 delims=:" %%C in (\'chcp\') do set "_EAS_CAPABILITY_CP=%%C"',
      'chcp 65001 >nul',
      ...(fallback ? ['set "ELECTRON_RUN_AS_NODE=1"', 'set "EAS_CAPABILITY_NODE_FALLBACK=1"'] : []),
      `${invocation} %*`,
      'set "_EAS_CAPABILITY_EXIT=%errorlevel%"',
      'if defined _EAS_CAPABILITY_CP chcp %_EAS_CAPABILITY_CP% >nul',
      'endlocal & exit /b %_EAS_CAPABILITY_EXIT%',
      ''
    ].join('\r\n')
  }
  const invocation = [runner.command, ...runner.args, kind].map(posixLiteral).join(' ')
  // Assignments belong to this exec only. The launcher removes BOTH markers
  // before spawning the real CLI; Electron's mode must never leak to that child.
  return '#!/bin/sh\n' +
    `${fallback ? 'ELECTRON_RUN_AS_NODE=1 EAS_CAPABILITY_NODE_FALLBACK=1 ' : ''}exec ${invocation} "$@"\n`
}
function directory(p: string): void {
  const st = fs.lstatSync(p)
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Unsafe capability shim directory')
}
function ensureDirectory(p: string): void {
  try { fs.mkdirSync(p, { mode: 0o700 }) }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
  directory(p)
}

/** host must come from trusted Electron paths; never pass RPC-supplied directories.
 * Different resources/runners get different directories, preserving already-open
 * PTYs during an app-path change. No process-wide path-only cache can go stale. */
export function ensureCapabilityPtyShims(host: ShimHost, options: ShimOptions = {}): string {
  const platform = options.platform ?? process.platform
  const flavor = platform === 'win32' ? path.win32 : path.posix
  const resourceRoot = host.isPackaged ? host.resourcesPath : host.appPath
  if (!flavor.isAbsolute(resourceRoot) || !flavor.isAbsolute(host.userData)) throw new Error('Capability shim paths must be absolute')
  directory(host.userData)
  const script = flavor.join(resourceRoot, 'mcp', 'eas-pty-launcher.mjs')
  const runner = nodeRunner([script], { electron: options.electron ?? process.execPath, platform, exists: options.exists })
  const scripts = KINDS.map(kind => ({ kind, body: renderCapabilityPtyShim(kind, runner, platform) }))
  const revision = createHash('sha256').update(JSON.stringify({ platform, scripts })).digest('hex').slice(0, 24)
  const base = flavor.join(host.userData, 'capability-pty-bin')
  ensureDirectory(base)
  const bin = flavor.join(base, revision)
  ensureDirectory(bin)
  for (const { kind, body } of scripts) {
    const target = flavor.join(bin, kind + (platform === 'win32' ? '.cmd' : ''))
    // Exclusive temp creation + rename avoids following an existing executable
    // symlink. These are reproducible entry files, not an execution journal.
    const temp = flavor.join(bin, '.' + kind + '-' + randomUUID() + '.tmp')
    try {
      fs.writeFileSync(temp, body, { encoding: 'utf8', mode: 0o700, flag: 'wx' })
      fs.renameSync(temp, target)
    } finally {
      try { fs.unlinkSync(temp) } catch { /* renamed or never created */ }
    }
  }
  return bin
}
