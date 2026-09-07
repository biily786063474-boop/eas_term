// 只读取官方 npm registry 的已发布原生平台包；不执行安装脚本、不改全局 CLI。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { PROBE_ENV } from '../probeEnv.ts'
import { validVersion } from './manager.ts'
import type { UpdatableCli } from '../../shared/cliUpdates.ts'

const run = promisify(execFile)
const REGISTRY = 'https://registry.npmjs.org/'
const PACKAGES = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' }
export const managedEnv = (): NodeJS.ProcessEnv => ({ ...PROBE_ENV, DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' })
export function safeArchiveEntries(list: string, verbose: string): string[] {
  const entries = list.trim().split('\n').filter(Boolean)
  if (!entries.length || entries.some(p => !p.startsWith('package/') || p.includes('\\') || p.split('/').includes('..') || /[\x00-\x1f]/.test(p))) throw new Error('CLI 包包含不安全路径。')
  if (verbose.trim().split('\n').some(line => !/^[-d]/.test(line))) throw new Error('CLI 包包含不支持的链接或特殊文件。')
  return entries
}
async function metadata(name: string, version: string, signal: AbortSignal): Promise<any> {
  const res = await fetch(`${REGISTRY}${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), redirect: 'error' })
  if (!res.ok) throw new Error(`无法读取 CLI 官方版本（HTTP ${res.status}）。`)
  const text = await res.text()
  if (text.length > 2_000_000) throw new Error('版本信息过大。')
  return JSON.parse(text)
}
export async function latestVersion(id: UpdatableCli, signal: AbortSignal): Promise<string> {
  const data = await metadata(PACKAGES[id], 'latest', signal)
  if (data.name !== PACKAGES[id] || !validVersion(data.version)) throw new Error('官方稳定版本信息无效。')
  return data.version
}
function platformPackage(id: UpdatableCli, version: string): [string, string] {
  if (!['darwin', 'linux', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('此平台暂不支持 CLI 自动更新。')
  // Linux musl 与 glibc 使用不同的原生包，不能盲装 glibc。
  const musl = process.platform === 'linux' && !(process.report?.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime
  if (musl && id === 'codex') throw new Error('此 Linux 环境请使用 CLI 官方安装器更新。')
  const suffix = `${process.platform}-${process.arch}${musl ? '-musl' : ''}`
  return id === 'codex' ? [PACKAGES.codex, `${version}-${suffix}`] : [`${PACKAGES.claude}-${suffix}`, version]
}
function versionDir(root: string, id: UpdatableCli, version: string): string {
  if (!validVersion(version)) throw new Error('无效 CLI 版本。')
  return path.join(root, id, version)
}
function verifyBinary(bin: string, id: UpdatableCli, version: string): void {
  const options = { env: managedEnv(), timeout: 8000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], encoding: 'utf8' as const }
  const actual = execFileSync(bin, ['--version'], options).match(/\b\d+\.\d+\.\d+\b/)?.[0]
  if (actual !== version) throw new Error('CLI 版本校验不一致，继续使用当前版本。')
  const help = execFileSync(bin, id === 'codex' ? ['exec', '--help'] : ['--help'], options)
  const flags = id === 'codex' ? ['--json', '--sandbox', '--skip-git-repo-check'] : ['--input-format', '--output-format', '--strict-mcp-config', '--effort', '--include-partial-messages']
  if (flags.some(flag => !help.includes(flag))) throw new Error('新 CLI 缺少对话所需参数，已保留当前版本。')
}
export function verifyVersion(root: string, id: UpdatableCli, version: string): string {
  const dir = versionDir(root, id, version)
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'entry.json'), 'utf8'))
  if (typeof marker.bin !== 'string' || !marker.bin.startsWith('package/') || marker.bin.includes('\\') || marker.bin.split('/').includes('..')) throw new Error('CLI 入口无效。')
  const bin = path.join(dir, marker.bin)
  if (!fs.realpathSync(bin).startsWith(fs.realpathSync(dir) + path.sep)) throw new Error('CLI 入口越界。')
  verifyBinary(bin, id, version)
  return bin
}
export async function stageVersion(root: string, id: UpdatableCli, version: string, signal: AbortSignal): Promise<void> {
  const final = versionDir(root, id, version)
  if (fs.existsSync(final)) { verifyVersion(root, id, version); return }
  const [name, packageVersion] = platformPackage(id, version)
  const meta = await metadata(name, packageVersion, signal)
  const url = new URL(meta.dist?.tarball)
  if (meta.name !== name || meta.version !== packageVersion || url.origin !== new URL(REGISTRY).origin || url.username || url.password || !/^sha512-[A-Za-z0-9+/]+=*$/.test(meta.dist?.integrity ?? '')) throw new Error('CLI 包来源或完整性信息无效。')
  await fsp.mkdir(path.dirname(final), { recursive: true })
  const temp = `${final}.download-${randomUUID()}`
  await fsp.mkdir(temp)
  try {
    const archive = path.join(temp, 'download.tgz')
    const combined = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)])
    const res = await fetch(url, { signal: combined, redirect: 'error' })
    if (!res.ok || !res.body) throw new Error(`CLI 下载失败（HTTP ${res.status}）。`)
    const hash = createHash('sha512')
    let size = 0
    const check = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > 512 * 1024 * 1024) return callback(new Error('CLI 包超过大小限制。'))
      hash.update(chunk); callback(null, chunk)
    } })
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), check, fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal: combined })
    if (`sha512-${hash.digest('base64')}` !== meta.dist.integrity) throw new Error('CLI 下载校验失败，未切换版本。')
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar'
    const opts = { timeout: 60000, maxBuffer: 4 * 1024 * 1024, signal }
    const listing = await run(tar, ['-tzf', archive], opts)
    const detail = await run(tar, ['-tvzf', archive], opts)
    const entries = safeArchiveEntries(listing.stdout, detail.stdout)
    const leaf = id === 'codex' ? 'codex' : 'claude'
    const candidates = entries.filter(e => e.endsWith(`/${leaf}${process.platform === 'win32' ? '.exe' : ''}`))
    if (candidates.length !== 1) throw new Error('无法识别官方 CLI 可执行入口。')
    await run(tar, ['-xzf', archive, '-C', temp], opts)
    const bin = path.join(temp, candidates[0])
    if (process.platform !== 'win32') await fsp.chmod(bin, 0o755)
    verifyBinary(bin, id, version)
    signal.throwIfAborted()
    await fsp.writeFile(path.join(temp, 'entry.json'), JSON.stringify({ bin: candidates[0], integrity: meta.dist.integrity }))
    await fsp.unlink(archive)
    await fsp.rename(temp, final)
  } finally { await fsp.rm(temp, { recursive: true, force: true }) }
}
export async function systemVersion(id: UpdatableCli): Promise<string | undefined> {
  try {
    const { stdout } = await run(id, ['--version'], { env: managedEnv(), timeout: 8000 })
    return stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0]
  } catch { return undefined }
}
