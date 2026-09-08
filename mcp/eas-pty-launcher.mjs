#!/usr/bin/env node
// Managed PTY invocation boundary. No credential files, global process cleanup,
// model calls, or request replay. Parent PTY revocation is the final cleanup net.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KINDS = new Set(['claude', 'codex', 'omp'])
const HERE = fileURLToPath(import.meta.url)
function managedPath(p, platform) {
  const parts = p.split(/[\\/]/)
  return parts.some(part => (platform === 'win32' ? part.toLowerCase() : part) === 'capability-pty-bin') || p === HERE
}
function realExecutable(p, platform) {
  try {
    const real = fs.realpathSync(p)
    if (!fs.statSync(real).isFile()) return undefined
    if (platform !== 'win32') fs.accessSync(real, fs.constants.X_OK)
    return real
  } catch { return undefined }
}
/** Probe injection only isolates Windows PATH parsing in host-independent tests. */
export function resolveCapabilityCli(kind, env, platform = process.platform, probe = p => realExecutable(p, platform)) {
  if (!KINDS.has(kind)) throw new Error('Unsupported managed CLI')
  const flavor = platform === 'win32' ? path.win32 : path.posix
  const checked = p => {
    if (managedPath(p, platform)) return undefined
    const real = probe(p)
    if (!real || managedPath(real, platform)) return undefined
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(real)) throw new Error('Windows .cmd/.bat CLI entry is unsupported; use a native executable')
    return real
  }
  if (kind === 'omp') {
    const bin = env.EAS_OMP_BINARY
    if (!bin || !flavor.isAbsolute(bin)) throw new Error('Managed OMP binary is unavailable')
    const real = checked(bin)
    if (!real) throw new Error('Managed OMP binary is unavailable')
    return real
  }
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
  const extKey = Object.keys(env).find(k => k.toLowerCase() === 'pathext') ?? 'PATHEXT'
  const extensions = platform === 'win32'
    ? (env[extKey] || '.COM;.EXE;.BAT;.CMD').split(';').filter(e => /^\.[a-z0-9]+$/i.test(e))
    : ['']
  for (let dir of (env[pathKey] || '').split(platform === 'win32' ? ';' : ':')) {
    if (dir.startsWith('"') && dir.endsWith('"')) dir = dir.slice(1, -1)
    // Empty PATH segments have the shell's normal current-directory meaning.
    dir = flavor.resolve(dir || '.')
    if (managedPath(dir, platform)) continue
    for (const ext of extensions) {
      const real = checked(flavor.join(dir, kind + ext))
      if (real) return real
    }
  }
  throw new Error('Real managed CLI executable was not found')
}
function post(port, route, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: route,
      headers: { Connection: 'close', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        text += chunk
        if (text.length > 4 * 1024 * 1024) req.destroy(new Error('Capability response too large'))
      })
      res.on('error', reject)
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error('Capability launch failed')
          resolve(JSON.parse(text))
        } catch { reject(new Error('Capability launch response invalid')) }
      })
    })
    const timer = setTimeout(() => req.destroy(new Error('Capability request timed out')), timeoutMs)
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
    req.end(payload)
  })
}
function managedParent(env) {
  const raw = env.EAS_CAPABILITY_PARENT, port = Number(env.EAS_TERM_PORT)
  if (!raw || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('This CLI entry requires a managed Eas-Term terminal')
  let parent
  try { parent = JSON.parse(raw) } catch { throw new Error('Invalid managed terminal authorization') }
  if (!parent || typeof parent !== 'object' || ['instanceId','generation','id','secret'].some(k => typeof parent[k] !== 'string' || !parent[k])) throw new Error('Invalid managed terminal authorization')
  return { parent, port }
}
function launchResult(reply) {
  const r = reply?.result
  if (reply?.ok !== true || !r || typeof r.leaseId !== 'string' || !r.leaseId ||
      typeof r.command !== 'string' || !path.isAbsolute(r.command) || !Array.isArray(r.args) ||
      r.args.some(a => typeof a !== 'string' || a.includes('\0')) || !r.env || typeof r.env !== 'object' ||
      Array.isArray(r.env) || Object.values(r.env).some(v => typeof v !== 'string' || v.includes('\0'))) throw new Error('Managed CLI launch was refused')
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(r.command)) throw new Error('Windows batch CLI launch is unsupported')
  return r
}
export async function runCapabilityPtyLauncher(argv = process.argv.slice(2), env = process.env) {
  const [kind, ...args] = argv
  const { parent, port } = managedParent(env)
  const binary = resolveCapabilityCli(kind, env)
  let child, leaseId, cancelled
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const handlers = new Map(signals.map(signal => [signal, () => {
    // With inherited foreground TTY, the kernel already delivers Ctrl-C to
    // both processes. Forwarding doubles native interruption; marking this as
    // cancellation would turn a cancelled model turn into a terminated CLI.
    if (signal === 'SIGINT' && child && process.stdin.isTTY) return
    cancelled ??= signal
    if (child) { try { child.kill(signal) } catch { /* already exited */ } }
  }]))
  for (const [signal, handler] of handlers) process.on(signal, handler)
  try {
    const reply = await post(port, '/capability/launch', { parent, kind, cwd: process.cwd(), binary, args }, 10000)
    // A malformed successful reply can still have allocated a lease: close it.
    if (reply?.ok === true && typeof reply?.result?.leaseId === 'string') leaseId = reply.result.leaseId
    const result = launchResult(reply)
    if (cancelled) return signalCode(cancelled)
    const baseEnv = { ...env }
    // The lease is the sole workbench authority. An inherited legacy token
    // would let old global MCP registrations bypass module/lease restrictions.
    // Secret grants have their own PTY boundary and are deliberately preserved.
    for (const key of ['EAS_TERM_TOKEN', 'EAS_PROJECT', 'EAS_PTY_ID', 'EAS_TEAM_ROLE']) delete baseEnv[key]
    delete baseEnv.EAS_CAPABILITY_PARENT
    if (baseEnv.EAS_CAPABILITY_NODE_FALLBACK === '1') delete baseEnv.ELECTRON_RUN_AS_NODE
    delete baseEnv.EAS_CAPABILITY_NODE_FALLBACK
    if (kind === 'omp') {
      // Keep caller secrets/PATH, but remove all conflicting native profile roots
      // before applying the main process's small directory-only managed overlay.
      const roots = new Set(['HOME', 'PI_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'OMP_PROFILE', 'PI_PROFILE',
        'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'])
      for (const key of Object.keys(baseEnv)) if (roots.has(key.toUpperCase())) delete baseEnv[key]
      if (!result.env.PI_CODING_AGENT_DIR || !path.isAbsolute(result.env.PI_CODING_AGENT_DIR) || !result.env.HOME || !result.env.PI_CONFIG_DIR) {
        throw new Error('Managed OMP directory configuration is missing')
      }
    }
    const childEnv = { ...baseEnv, ...result.env }
    // Main may intentionally provide Electron's mode for its returned command,
    // but the parent capability and launcher marker never belong to the CLI.
    delete childEnv.EAS_CAPABILITY_PARENT
    delete childEnv.EAS_CAPABILITY_NODE_FALLBACK
    return await new Promise(resolve => {
      try { child = spawn(result.command, result.args, { cwd: process.cwd(), env: childEnv, stdio: 'inherit', shell: false }) }
      catch { resolve(1); return }
      child.once('error', () => resolve(1))
      child.once('exit', (code, signal) => resolve(code ?? signalCode(signal)))
    })
  } finally {
    if (leaseId) {
      try { await post(port, '/capability/launch/close', { parent, leaseId }, 1500) }
      catch { /* Parent PTY revocation owns the fallback. Never retry. */ }
    }
    for (const [signal, handler] of handlers) process.off(signal, handler)
  }
}
function signalCode(signal) { return ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 })[signal] ?? 1 }
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCapabilityPtyLauncher().then(code => { process.exitCode = code }, () => {
    // Do not print HTTP bodies, environment, or arbitrary upstream exceptions.
    process.stderr.write('Eas-Term managed CLI launch failed; no automatic retry.\n')
    process.exitCode = 1
  })
}
