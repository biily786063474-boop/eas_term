import type { PluginRequirements, PluginHostCapabilities } from '../shared/pluginCompatibility.ts'
type Result = { ok: true } | { ok: false; reason: string }
type Parsed = { ok: true; requirements: PluginRequirements | undefined } | { ok: false; reason: string }
const keys = ['minHostVersion', 'platforms', 'architectures', 'capabilities']
function versionParts(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return
  const parts = value.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : undefined
}
export function parsePluginRequirements(raw: unknown): Parsed {
  if (raw === undefined) return { ok: true, requirements: undefined }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'requirements 必须是对象' }
  const r = raw as Record<string, unknown>
  if (Object.keys(r).some(k => !keys.includes(k))) return { ok: false, reason: '存在未知宿主要求' }
  const requirements: PluginRequirements = {}
  if ('minHostVersion' in r) {
    if (!versionParts(r.minHostVersion)) return { ok: false, reason: '最低宿主版本格式错误' }
    requirements.minHostVersion = r.minHostVersion as string
  }
  for (const key of ['platforms', 'architectures', 'capabilities'] as const) {
    if (!(key in r)) continue
    const values = r[key]
    if (!Array.isArray(values) || !values.length || values.length > 64 ||
        !values.every(v => typeof v === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(v)) ||
        new Set(values).size !== values.length) return { ok: false, reason: key + ' 要求格式错误' }
    if (key === 'platforms' && values.some(v => !['darwin','win32','linux'].includes(v))) return { ok: false, reason: '不支持的平台声明' }
    if (key === 'architectures' && values.some(v => !['arm64','x64','ia32','arm'].includes(v))) return { ok: false, reason: '不支持的架构声明' }
    requirements[key] = [...values]
  }
  return { ok: true, requirements }
}
export function checkPluginCompatibility(requirements: PluginRequirements | undefined, host: PluginHostCapabilities): Result {
  const parsed = parsePluginRequirements(requirements)
  if (!parsed.ok) return parsed
  const r = parsed.requirements
  if (!r) return { ok: true }
  if (r.minHostVersion) {
    const actual = versionParts(host.version), minimum = versionParts(r.minHostVersion)!
    if (!actual) return { ok: false, reason: '无法确认宿主版本' }
    for (let i = 0; i < 3; i++) {
      if (actual[i] < minimum[i]) return { ok: false, reason: '需要软件 ' + r.minHostVersion + ' 或更高版本' }
      if (actual[i] > minimum[i]) break
    }
  }
  if (r.platforms && !r.platforms.includes(host.platform)) return { ok: false, reason: '插件不支持当前系统' }
  if (r.architectures && !r.architectures.includes(host.architecture)) return { ok: false, reason: '插件不支持当前架构' }
  const missing = r.capabilities?.filter(c => !host.capabilities.includes(c))
  if (missing?.length) return { ok: false, reason: '宿主缺少能力：' + missing.join('、') }
  return { ok: true }
}

/** Never trust the directory to omit requirements imposed by the downloaded package. */
export function checkPackageRequirements(raw: unknown, declared: PluginRequirements | undefined, host: PluginHostCapabilities): Result {
  const parsed = parsePluginRequirements(raw)
  if (!parsed.ok) return parsed
  const directory = parsePluginRequirements(declared)
  if (!directory.ok) return directory
  const canonical = (r: PluginRequirements | undefined): string => JSON.stringify({
    minHostVersion: r?.minHostVersion,
    platforms: r?.platforms && [...r.platforms].sort(),
    architectures: r?.architectures && [...r.architectures].sort(),
    capabilities: r?.capabilities && [...r.capabilities].sort()
  })
  if (canonical(parsed.requirements) !== canonical(directory.requirements)) return { ok:false, reason:'包内宿主要求与目录声明不一致' }
  return checkPluginCompatibility(parsed.requirements, host)
}
