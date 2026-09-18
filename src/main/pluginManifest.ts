import { parsePluginConfig } from '../shared/pluginConfig.ts'
import { pluginVersion } from '../shared/pluginUpdate.ts'
// 自家插件清单 `plugin.json` → PluginInfo。**纯函数，零 electron。**
// 设计稿 §M。字段名借 Codex 的 interface 块（displayName / brandColor / composerIcon /
// defaultPrompt），现有 picker UI 一行不改就能显示。
//
// 校验原则：**能修的修、修不了的整份拒**。permissions 里不认识的工具丢掉并记 warning
// （拒了整份会让一个拼错的权限名把插件整个藏起来，用户看到的是「插件不见了」）；
// name / mcp.command / panels[].entry 这些错了没法运行，才整份拒。
import path from 'node:path'
import { validateRemoteEndpoint } from './pluginConnections/endpointPolicy.ts'
import type { PluginInfo, PluginPanelDef } from '../shared/types'
import { CANVAS_CALL_ALLOWLIST, PANEL_SIZE_MAX, PANEL_SIZE_MIN } from '../shared/pluginProtocol.ts'

export type ManifestResult =
  | { ok: true; info: PluginInfo; warnings: string[] }
  | { ok: false; errors: string[] }

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const PANEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/

const rec = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** 插件目录内的相对路径才合法：不许绝对、不许 `..` 跳出去 */
function insideDir(rel: string): boolean {
  if (!rel || path.isAbsolute(rel)) return false
  const norm = path.posix.normalize(rel.replace(/\\/g, '/'))
  return !norm.startsWith('../') && norm !== '..'
}

export function parseManifest(
  raw: unknown,
  dir: string,
  opts: { builtin?: boolean; exists?: (abs: string) => boolean } = {}
): ManifestResult {
  const errors: string[] = []
  const warnings: string[] = []
  const m = rec(raw)
  if (!m) return { ok: false, errors: ['plugin.json 不是对象'] }

  const name = str(m.name)
  if (!name || !NAME_RE.test(name)) errors.push('name 只许小写字母/数字/连字符，1–40 位')
  else if (name !== path.basename(dir)) errors.push(`name「${name}」必须和目录名「${path.basename(dir)}」一致`)

  let config: PluginInfo['config']
  try {
    config=parsePluginConfig(m.config)
    if(config){
      const caps=rec(m.requirements)?.capabilities
      if(!Array.isArray(caps)||!caps.includes('config.fields'))throw Error('配置插件必须声明config.fields兼容要求')
    }
  } catch(error){errors.push(error instanceof Error?error.message:'配置无效')}

  // mcp
  const mcpRaw = rec(m.mcp)
  const command = str(mcpRaw?.command)
  let remote: PluginInfo['remote']
  if (mcpRaw?.transport === 'streamable-http') {
    try {
      if (Object.keys(mcpRaw).some(k => !['transport','url','auth','approvedOrigins','oauth','bearer'].includes(k))) throw Error('远程清单不接受命令、环境变量或未知字段')
      const requirements=rec(m.requirements)
      if(!Array.isArray(requirements?.capabilities)||!requirements.capabilities.includes('mcp.remote'))throw Error('远程插件必须声明mcp.remote兼容要求')
      const origins=mcpRaw.approvedOrigins
      if (!Array.isArray(origins)||!origins.length||origins.length>16||origins.some(v=>typeof v!=='string')||new Set(origins).size!==origins.length) throw Error('远程来源列表无效')
      for(const origin of origins) if(validateRemoteEndpoint(origin,origins).origin!==origin) throw Error('远程授权来源必须是精确origin')
      const url=validateRemoteEndpoint(String(mcpRaw.url),origins).href
      const base={transport:'streamable-http' as const,url,approvedOrigins:[...origins]}
      if(mcpRaw.auth==='none'){
        if(mcpRaw.oauth!==undefined||mcpRaw.bearer!==undefined)throw Error('无需认证的端点不能附带OAuth配置')
        remote={...base,auth:'none'}
      }else if(mcpRaw.auth==='bearer'){
        if(!requirements!.capabilities.includes('auth.bearer'))throw Error('Bearer插件必须声明auth.bearer兼容要求')
        const bearer=rec(mcpRaw.bearer)
        if(mcpRaw.oauth!==undefined||!bearer||Object.keys(bearer).length!==1||typeof bearer.field!=='string')throw Error('Bearer仅允许引用配置secret字段')
        const field=config?.fields.find(f=>f.id===bearer.field)
        if(config?.fields.length!==1||!field||field.type!=='secret'||!field.required)throw Error('Bearer需要唯一的必填secret配置字段')
        remote={...base,auth:'bearer',bearer:{field:bearer.field}}
      }else if(mcpRaw.auth==='oauth'){
        if(mcpRaw.bearer!==undefined)throw Error('OAuth不能混用Bearer配置')
        if(!(requirements!.capabilities as unknown[]).includes('auth.oauth'))throw Error('OAuth插件必须声明auth.oauth兼容要求')
        const o=rec(mcpRaw.oauth)
        if(!o||Object.keys(o).some(k=>!['issuer','authorizationEndpoint','tokenEndpoint','clientId','scope'].includes(k)))throw Error('OAuth仅接受公开客户端固定配置，禁止内嵌密钥')
        for(const key of ['issuer','authorizationEndpoint','tokenEndpoint']){
          if(typeof o[key]!=='string')throw Error('OAuth端点无效')
          validateRemoteEndpoint(o[key] as string,origins)
        }
        if(typeof o.clientId!=='string'||!o.clientId.trim()||o.clientId.length>2048||/[\x00-\x1f\x7f]/.test(o.clientId))throw Error('OAuth客户端ID无效')
        if(o.scope!==undefined&&(typeof o.scope!=='string'||!o.scope||o.scope.length>4096||!/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(o.scope)))throw Error('OAuth scope无效')
        remote={...base,auth:'oauth',oauth:{issuer:o.issuer as string,authorizationEndpoint:new URL(o.authorizationEndpoint as string).href,tokenEndpoint:new URL(o.tokenEndpoint as string).href,clientId:o.clientId,...(o.scope?{scope:o.scope as string}:{})}}
      }else throw Error('远程认证方式必须明确声明')
    } catch(error) {errors.push(error instanceof Error?error.message:'远程配置无效')}
  } else {
    if(mcpRaw?.transport!==undefined&&mcpRaw.transport!=='stdio')errors.push('未知MCP传输')
    if (!command) errors.push('mcp.command 必填')
  }
  const argsRaw = Array.isArray(mcpRaw?.args) ? mcpRaw!.args : []
  const args: string[] = []
  for (const a of argsRaw) {
    if (typeof a !== 'string') {
      errors.push('mcp.args 只能是字符串数组')
      break
    }
    // `./server.mjs` 这类相对路径按插件目录解开；`..` 一律拒
    if (a.startsWith('./') || a.startsWith('../')) {
      if (!insideDir(a)) {
        errors.push(`mcp.args 里的「${a}」跳出了插件目录`)
        break
      }
      args.push(path.join(dir, a))
    } else args.push(a)
  }
  const envRaw = rec(mcpRaw?.env) ?? {}
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(envRaw)) {
    if (typeof v === 'string') env[k] = v
    else warnings.push(`mcp.env.${k} 不是字符串，已忽略`)
  }

  // panels
  const panels: PluginPanelDef[] = []
  const panelsRaw = Array.isArray(m.panels) ? m.panels : []
  const seen = new Set<string>()
  for (const p of panelsRaw) {
    const pr = rec(p)
    const id = str(pr?.id)
    const entry = str(pr?.entry)
    if (!id || !PANEL_ID_RE.test(id)) {
      errors.push('panels[].id 只许小写字母/数字/连字符')
      continue
    }
    if (seen.has(id)) {
      errors.push(`panels 里 id「${id}」重复`)
      continue
    }
    seen.add(id)
    if (!entry || !(entry.startsWith('ui://') || insideDir(entry))) {
      errors.push(`panels「${id}」的 entry 必须是 ui:// 或插件目录内的相对路径`)
      continue
    }
    const size = rec(pr?.defaultSize)
    const clamp = (v: unknown, d: number): number => {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : d
      return Math.min(PANEL_SIZE_MAX, Math.max(PANEL_SIZE_MIN, Math.round(n)))
    }
    panels.push({
      id,
      title: str(pr?.title) ?? id,
      tool: str(pr?.tool),
      entry,
      defaultSize: { w: clamp(size?.w, 460), h: clamp(size?.h, 340) }
    })
  }

  // permissions.canvas：和宿主全局白名单取交集，不认识的丢掉记 warning
  const permRaw = rec(m.permissions)
  const canvasReq = Array.isArray(permRaw?.canvas) ? permRaw!.canvas : []
  const canvas: string[] = []
  for (const t of canvasReq) {
    if (typeof t !== 'string') continue
    if ((CANVAS_CALL_ALLOWLIST as readonly string[]).includes(t)) canvas.push(t)
    else warnings.push(`permissions.canvas 里的「${t}」不在宿主允许集内，已忽略`)
  }

  const brand = str(m.brandColor)
  if (brand && !HEX_RE.test(brand)) warnings.push('brandColor 不是 #rrggbb，已忽略')

  const iconRel = str(m.composerIcon) ?? str(m.logo)
  let iconPath: string | undefined
  if (iconRel) {
    if (!insideDir(iconRel)) warnings.push('composerIcon 跳出了插件目录，已忽略')
    else {
      const abs = path.join(dir, iconRel)
      if (!opts.exists || opts.exists(abs)) iconPath = abs
      else warnings.push('composerIcon 指向的文件不存在，已忽略')
    }
  }

  if (errors.length) return { ok: false, errors }
  const info: PluginInfo = {
    id: `eas:${name}`,
    cli: 'eas',
    name: name!,
    version: pluginVersion(m.version),
    displayName: str(m.displayName) ?? name!,
    description: str(m.description),
    category: str(m.category),
    brandColor: brand && HEX_RE.test(brand) ? brand : undefined,
    iconPath,
    defaultPrompt: str(m.defaultPrompt),
    // 故意不填 mcpServers：那条老路会让 harness 自己 spawn 插件进程，
    // 自家插件一律走转发 shim（设计稿决定 #2）
    mcpServers: undefined,
    root: dir,
    panels,
    permissions: { canvas },
    mcp: remote ? undefined : { command: command!, args, env, cwd: dir },
    remote,
    config,
    builtin: !!opts.builtin
  }
  return { ok: true, info, warnings }
}
