// 角色存档的清洗与 v1 → v2 迁移。**零 electron 依赖**，`roles.ts` 调它，测试裸跑。
//
// 逐条规范化：坏的那条丢掉而不是整份失败（同 canvasSlice 的 sanitizeCanvas 的思路）。
// 这文件用户和外部工具都能改，一条坏数据不该让整个角色系统失效。
import type { AgentRole, HarnessId, RoleCaps, RoleRaw } from '../shared/types'
import { CLAUDE_WRITE_TOOLS, IMAGE_MCP_PATTERNS } from '../shared/roleBinding.ts' // 带 .ts：本文件要在 node --test 下裸跑

export const ROLES_FILE_VERSION = 2

const HARNESSES: readonly HarnessId[] = ['claude', 'codex', 'omp']

function str(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : dflt
}
function strMap(v: unknown): Partial<Record<HarnessId, string>> {
  const o = (v ?? {}) as Record<string, unknown>
  const out: Partial<Record<HarnessId, string>> = {}
  for (const k of HARNESSES) if (typeof o[k] === 'string' && o[k]) out[k] = o[k] as string
  return out
}
/** 全是非空字符串才收；否则整条当没有（安全边界上不做「部分接受」） */
function strList(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || !v.length) return undefined
  return v.every((x) => typeof x === 'string' && x) ? (v as string[]) : undefined
}

/** v1 的 `tools` → v2 的 `caps` + `raw`。规则见 spec 6.6。 */
export function migrateToolsV1(tools: { allow?: unknown; deny?: unknown; denyServers?: unknown } | undefined): {
  caps?: RoleCaps
  raw?: RoleRaw
  droppedAllow: string[]
} {
  const deny = new Set(strList(tools?.deny) ?? [])
  const caps: RoleCaps = {}
  if (deny.has('Write') && deny.has('Edit')) {
    caps.write = false
    for (const t of CLAUDE_WRITE_TOOLS) deny.delete(t)
  }
  if (deny.has('Bash')) {
    caps.shell = false
    deny.delete('Bash')
  }
  const imagePrefixed = IMAGE_MCP_PATTERNS.map((p) => `mcp__${p}`)
  if (imagePrefixed.every((p) => deny.has(p))) {
    caps.imageGen = false
    for (const p of imagePrefixed) deny.delete(p)
  }
  const denyTools = [...deny].filter((d) => d.startsWith('mcp__')).map((d) => d.slice('mcp__'.length))
  for (const d of denyTools) deny.delete(`mcp__${d}`)
  const denyServers = strList(tools?.denyServers)
  if (denyServers || denyTools.length) {
    caps.mcp = { ...(denyServers ? { denyServers } : {}), ...(denyTools.length ? { denyTools } : {}) }
  }
  const leftover = [...deny]
  return {
    caps: Object.keys(caps).length ? caps : undefined,
    raw: leftover.length ? { claude: { deny: leftover } } : undefined,
    droppedAllow: strList(tools?.allow) ?? []
  }
}

function sanitizeCaps(v: unknown): RoleCaps | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const caps: RoleCaps = {}
  if (o.write === false) caps.write = false
  if (o.shell === false) caps.shell = false
  if (o.imageGen === false) caps.imageGen = false
  const m = (o.mcp ?? {}) as Record<string, unknown>
  const denyServers = strList(m.denyServers)
  const denyTools = strList(m.denyTools)
  if (denyServers || denyTools) caps.mcp = { ...(denyServers ? { denyServers } : {}), ...(denyTools ? { denyTools } : {}) }
  return Object.keys(caps).length ? caps : undefined
}

function sanitizeRaw(v: unknown): RoleRaw | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, Record<string, unknown> | undefined>
  const raw: RoleRaw = {}
  const cd = strList(o.claude?.deny)
  const xd = strList(o.codex?.disable)
  const od = strList(o.omp?.removeTools)
  if (cd) raw.claude = { deny: cd }
  if (xd) raw.codex = { disable: xd }
  if (od) raw.omp = { removeTools: od }
  return Object.keys(raw).length ? raw : undefined
}

/** v1 与 v2 记录都收：有 `caps` 按 v2；否则有 `tools` 就迁移。输出永远是 v2 形状（不带 tools）。 */
export function sanitizeRoles(raw: unknown): AgentRole[] {
  const list = (raw as { roles?: unknown } | null)?.roles
  if (!Array.isArray(list)) return []
  const out: AgentRole[] = []
  const seen = new Set<string>()
  for (const it of list) {
    const r = (it ?? {}) as Record<string, unknown>
    const id = str(r.id).trim()
    const name = str(r.name).trim()
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const k = str(r.kind, 'auto')
    let caps = sanitizeCaps(r.caps)
    let rawArgs = sanitizeRaw(r.raw)
    if (!caps && !rawArgs && r.tools && typeof r.tools === 'object') {
      const m = migrateToolsV1(r.tools as Record<string, unknown>)
      caps = m.caps
      rawArgs = m.raw
      if (m.droppedAllow.length) console.warn(`[roles] 角色 ${id} 的 tools.allow 已弃用，丢弃：${m.droppedAllow.join(', ')}`)
    }
    out.push({
      id,
      name,
      desc: str(r.desc),
      group: r.group === 'main' ? 'main' : 'output',
      color: str(r.color, '#a3a3a3'),
      kind: k === 'claude' || k === 'codex' ? k : 'auto',
      model: strMap(r.model),
      effort: strMap(r.effort),
      contract: str(r.contract),
      ...(caps ? { caps } : {}),
      ...(rawArgs ? { raw: rawArgs } : {}),
      builtin: r.builtin === true
    })
  }
  return out
}
