// 官方插件目录 `registry.json` → 校验后的条目。**纯函数，零 electron，`node --test` 裸跑。**
//
// registry 是「目录」:哪些插件、下载地址、哈希、展示元数据。它**不是**插件清单——
// 真正的 `plugin.json` 校验在插件装完后走 `pluginManifest.parseManifest`。这里只保证:
//   · 下载地址是 https 且在允许域名内(第一步 eas.biily.top;切阿里云 OSS 时把 CDN 域名加进 allowedHosts)
//   · sha256 / version / size 格式正确(下载校验与更新比对要用)
//   · 展示字段(displayName/brandColor…)带过给 UI
// 原则同 parseManifest:**坏条目丢弃记 warning,整份格式错才拒**——一个拼错的条目
// 不该把整个市场藏起来。
export interface RegistryEntry {
  name: string
  displayName: string
  description?: string
  category?: string
  brandColor?: string
  version: string
  url: string
  sha256: string
  size: number
  permissions?: Record<string, string[]>
}
export type RegistryResult =
  | { ok: true; entries: RegistryEntry[]; warnings: string[] }
  | { ok: false; errors: string[] }

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/       // 同 pluginManifest,落盘目录名
const SEMVER_RE = /^\d+\.\d+\.\d+$/                // 简化 semver（major.minor.patch）
const SHA256_RE = /^[a-f0-9]{64}$/
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const rec = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

function httpsHostAllowed(url: string, allowedHosts: readonly string[]): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && allowedHosts.includes(u.hostname)
  } catch {
    return false
  }
}

/** permissions 只做结构校验(值须为字符串数组);真正的权限白名单在 parseManifest。展示用。 */
function normalizePermissions(v: unknown): Record<string, string[]> | undefined {
  const m = rec(v)
  if (!m) return undefined
  const out: Record<string, string[]> = {}
  for (const [k, val] of Object.entries(m)) {
    if (Array.isArray(val) && val.every((x) => typeof x === 'string')) out[k] = val as string[]
  }
  return out
}

export function parseRegistry(raw: unknown, opts: { allowedHosts: readonly string[] }): RegistryResult {
  const m = rec(raw)
  if (!m) return { ok: false, errors: ['registry 不是对象'] }
  if (m.schema !== 1) return { ok: false, errors: [`registry schema 不支持:${String(m.schema)}`] }
  if (!Array.isArray(m.plugins)) return { ok: false, errors: ['registry.plugins 不是数组'] }
  const entries: RegistryEntry[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const p of m.plugins) {
    const e = rec(p)
    const name = str(e?.name)
    if (!name || !NAME_RE.test(name)) { warnings.push(`丢弃条目:name 非法(${String(e?.name)})`); continue }
    if (seen.has(name)) { warnings.push(`丢弃重名条目:${name}`); continue }
    const version = str(e?.version)
    if (!version || !SEMVER_RE.test(version)) { warnings.push(`丢弃 ${name}:version 非法`); continue }
    const url = str(e?.url)
    if (!url || !httpsHostAllowed(url, opts.allowedHosts)) { warnings.push(`丢弃 ${name}:url 必须 https 且在允许域名内`); continue }
    const sha256 = str(e?.sha256)
    if (!sha256 || !SHA256_RE.test(sha256)) { warnings.push(`丢弃 ${name}:sha256 格式错`); continue }
    const size = e?.size
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) { warnings.push(`丢弃 ${name}:size 非正整数`); continue }
    const brandColor = str(e?.brandColor)
    seen.add(name)
    entries.push({
      name,
      displayName: str(e?.displayName) ?? name,
      description: str(e?.description),
      category: str(e?.category),
      brandColor: brandColor && HEX_COLOR_RE.test(brandColor) ? brandColor : undefined,
      version, url, sha256, size,
      permissions: normalizePermissions(e?.permissions)
    })
  }
  return { ok: true, entries, warnings }
}
