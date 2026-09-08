// Shared, read-only CLI resolution. Never parse or execute shell shim text.
import fs from 'node:fs'
import path from 'node:path'

const KINDS = new Set(['claude', 'codex', 'omp'])
function managedPath(p, platform) {
  const parts = p.split(/[\\/]/)
  return parts.some(part => (platform === 'win32' ? part.toLowerCase() : part) === 'capability-pty-bin') || (platform === 'win32' ? parts.at(-1)?.toLowerCase() : parts.at(-1)) === 'eas-pty-launcher.mjs'
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
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(real)) resolveNpmEntry(kind, real)
    return real
  }
  if (kind === 'omp') {
    const bin = env.EAS_OMP_BINARY
    if (!bin || !flavor.isAbsolute(bin)) throw new Error('Managed OMP binary is unavailable')
    const real = checked(bin)
    if (!real) throw new Error('Managed OMP binary is unavailable')
    return real
  }
  // PROBE_ENV can coexist with an inherited Windows `Path`; its canonical PATH wins.
  const pathKey = Object.hasOwn(env, 'PATH') ? 'PATH' : Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
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
const PACKAGES = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' }
const invalid = () => new Error('Unsupported Windows .cmd/.bat CLI package: repair the official Codex/Claude npm installation or select a native executable; no command was run')
function metadata(root, name) {
  const file = contained(root, 'package.json')
  if (fs.statSync(file).size > 1024 * 1024) throw invalid()
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (data.name !== name || typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.version)) throw invalid()
  return data
}
function contained(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\0\r\n]/.test(relative) || path.win32.isAbsolute(relative) || path.posix.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw invalid()
  const realRoot = fs.realpathSync(root), real = fs.realpathSync(path.join(root, relative))
  const rel = path.relative(realRoot, real)
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !fs.statSync(real).isFile()) throw invalid()
  return real
}
function nativeEntry(file, arch) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(64)
    if (fs.readSync(fd, head, 0, 64, 0) !== 64 || head.toString('ascii', 0, 2) !== 'MZ') throw invalid()
    const offset = head.readUInt32LE(60), pe = Buffer.alloc(6)
    if (offset < 64 || offset > fs.fstatSync(fd).size - 6 || fs.readSync(fd, pe, 0, 6, offset) !== 6 || pe.readUInt32LE(0) !== 0x4550) throw invalid()
    if (pe.readUInt16LE(4) !== ({ x64: 0x8664, arm64: 0xaa64 })[arch]) throw invalid()
    return file
  } finally { fs.closeSync(fd) }
}
/** Only npm's adjacent global/local node_modules layout is supported. Unknown wrappers fail
 * at the first PATH entry; we never fall through to another installed version. Metadata
 * proves layout/identity, not authenticity of files already writable by the local user. */
export function resolveNpmEntry(kind, shim, arch = process.arch) {
  try {
    if (!PACKAGES[kind] || !/\.cmd$/i.test(shim)) throw invalid()
    const dir = path.dirname(shim)
    const modules = path.basename(dir).toLowerCase() === '.bin' ? path.dirname(dir) : path.join(dir, 'node_modules')
    const root = path.join(modules, PACKAGES[kind])
    const meta = metadata(root, PACKAGES[kind])
    const bin = typeof meta.bin === 'string' ? meta.bin : meta.bin?.[kind]
    const supported = kind === 'codex' ? ['bin/codex.js'] : ['cli.js', 'bin/claude.exe']
    if (!supported.includes(bin)) throw invalid()
    const entry = contained(root, bin)
    if (bin.endsWith('.exe')) return { command: nativeEntry(entry, arch), args: [] }
    if (kind === 'codex' && ['x64', 'arm64'].includes(arch)) {
      const name = `@openai/codex-win32-${arch}`
      const dependency = meta.optionalDependencies?.[name]
      if (dependency !== undefined) {
        // Published Codex platform packages are npm aliases, retaining @openai/codex identity.
        const version = `${meta.version}-win32-${arch}`
        if (dependency !== `npm:@openai/codex@${version}`) throw invalid()
        const nested = path.join(root, 'node_modules', name), sibling = path.join(modules, name)
        const nativeRoot = fs.existsSync(nested) ? nested : sibling
        const nativeMeta = metadata(nativeRoot, PACKAGES.codex)
        if (nativeMeta.version !== version || !Array.isArray(nativeMeta.os) || !nativeMeta.os.includes('win32') || !Array.isArray(nativeMeta.cpu) || !nativeMeta.cpu.includes(arch)) throw invalid()
        const triple = arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc'
        const candidates = [`vendor/${triple}/bin/codex.exe`, `vendor/${triple}/codex/codex.exe`]
        const relative = candidates.find(p => fs.existsSync(path.join(nativeRoot, p)))
        if (!relative) throw invalid()
        return { command: nativeEntry(contained(nativeRoot, relative), arch), args: [], env: { CODEX_MANAGED_BY_NPM: '1' } }
      }
    }
    return { script: entry }
  } catch { throw invalid() }
}
/** runner is supplied only by the owning process (main's nodeRunner or this owned
 * launcher's current interpreter), never by a CLI shim or HTTP request. */
export function resolveCliInvocation(kind, binary, args, env, runner, platform = process.platform) {
  if (platform !== 'win32') return { command: binary, args: [...args] }
  const entry = path.win32.isAbsolute(binary) || path.isAbsolute(binary)
    ? realExecutable(binary, platform)
    : resolveCapabilityCli(kind, env, platform)
  if (!entry) throw invalid()
  if (!/\.(cmd|bat)$/i.test(entry)) {
    if (!/\.(exe|com)$/i.test(entry)) throw invalid()
    return { command: entry, args: [...args] }
  }
  const resolved = resolveNpmEntry(kind, entry)
  if (resolved.script) {
    if (!runner || !path.isAbsolute(runner.command) || /\.(?:cmd|bat)$/i.test(runner.command)) throw invalid()
    return { command: runner.command, args: [...runner.args, resolved.script, ...args], ...(runner.env ? { env: { ...runner.env } } : {}) }
  }
  return { ...resolved, args: [...resolved.args, ...args] }
}
