import { tm } from '../shared/i18n/current.ts'
import { parsePluginConfig } from '../shared/pluginConfig.ts'
import { pluginVersion } from '../shared/pluginUpdate.ts'
import { parsePluginRequirements } from './pluginCompatibility.ts'
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
  if (!m) return { ok: false, errors: [tm('errPlugin.manifest.e01')] }

  const name = str(m.name)
  if (!name || !NAME_RE.test(name)) errors.push(tm('errPlugin.manifest.e02'))
  else if (name !== path.basename(dir)) errors.push(tm('errPlugin.manifest.e03',{name,dir:path.basename(dir)}))

  let config: PluginInfo['config']
  try {
    config=parsePluginConfig(m.config)
    if(config){
      const caps=rec(m.requirements)?.capabilities
      if(!Array.isArray(caps)||!caps.includes('config.fields'))throw Error(tm('errPlugin.manifest.e04'))
      if(config.startup==='deferred'&&!caps.includes('config.deferred'))throw Error(tm('errPlugin.manifest.e05'))
    }
  } catch(error){errors.push(error instanceof Error?error.message:tm('errPlugin.manifest.e06'))}

  // mcp
  const mcpRaw = rec(m.mcp)
  const command = str(mcpRaw?.command)
  let remote: PluginInfo['remote']
  if (mcpRaw?.transport === 'streamable-http') {
    try {
      if (Object.keys(mcpRaw).some(k => !['transport','url','auth','approvedOrigins','oauth','bearer'].includes(k))) throw Error(tm('errPlugin.manifest.e07'))
      const requirements=rec(m.requirements)
      if(!Array.isArray(requirements?.capabilities)||!requirements.capabilities.includes('mcp.remote'))throw Error(tm('errPlugin.manifest.e08'))
      const origins=mcpRaw.approvedOrigins
      if (!Array.isArray(origins)||!origins.length||origins.length>16||origins.some(v=>typeof v!=='string')||new Set(origins).size!==origins.length) throw Error(tm('errPlugin.manifest.e09'))
      for(const origin of origins) if(validateRemoteEndpoint(origin,origins).origin!==origin) throw Error(tm('errPlugin.manifest.e10'))
      const url=validateRemoteEndpoint(String(mcpRaw.url),origins).href
      const base={transport:'streamable-http' as const,url,approvedOrigins:[...origins]}
      if(mcpRaw.auth==='none'){
        if(mcpRaw.oauth!==undefined||mcpRaw.bearer!==undefined)throw Error(tm('errPlugin.manifest.e11'))
        remote={...base,auth:'none'}
      }else if(mcpRaw.auth==='bearer'){
        if(!requirements!.capabilities.includes('auth.bearer'))throw Error(tm('errPlugin.manifest.e12'))
        const bearer=rec(mcpRaw.bearer)
        if(mcpRaw.oauth!==undefined||!bearer||Object.keys(bearer).length!==1||typeof bearer.field!=='string')throw Error(tm('errPlugin.manifest.e13'))
        const field=config?.fields.find(f=>f.id===bearer.field)
        if(config?.fields.length!==1||!field||field.type!=='secret'||!field.required)throw Error(tm('errPlugin.manifest.e14'))
        remote={...base,auth:'bearer',bearer:{field:bearer.field}}
      }else if(mcpRaw.auth==='oauth'){
        if(mcpRaw.bearer!==undefined)throw Error(tm('errPlugin.manifest.e15'))
        if(!(requirements!.capabilities as unknown[]).includes('auth.oauth'))throw Error(tm('errPlugin.manifest.e16'))
        const o=rec(mcpRaw.oauth)
        if(!o||Object.keys(o).some(k=>!['issuer','authorizationEndpoint','tokenEndpoint','clientId','registrationEndpoint','scope'].includes(k)))throw Error(tm('errPlugin.manifest.e17'))
        for(const key of ['issuer','authorizationEndpoint','tokenEndpoint']){
          if(typeof o[key]!=='string')throw Error(tm('errPlugin.manifest.e18'))
          validateRemoteEndpoint(o[key] as string,origins)
        }
        let client:{clientId:string}|{registrationEndpoint:string}
        if(o.registrationEndpoint!==undefined){
          if(o.clientId!==undefined||!requirements!.capabilities.includes('auth.oauth.dcr'))throw Error(tm('errPlugin.manifest.e19'))
          if(typeof o.registrationEndpoint!=='string')throw Error(tm('errPlugin.manifest.e20'))
          client={registrationEndpoint:validateRemoteEndpoint(o.registrationEndpoint,origins).href}
        }else{
          if(typeof o.clientId!=='string'||!o.clientId.trim()||o.clientId.length>2048||/[\x00-\x1f\x7f]/.test(o.clientId))throw Error(tm('errPlugin.manifest.e21'))
          client={clientId:o.clientId}
        }
        if(o.scope!==undefined&&(typeof o.scope!=='string'||!o.scope||o.scope.length>4096||!/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(o.scope)))throw Error(tm('errPlugin.manifest.e22'))
        remote={...base,auth:'oauth',oauth:{issuer:o.issuer as string,authorizationEndpoint:new URL(o.authorizationEndpoint as string).href,tokenEndpoint:new URL(o.tokenEndpoint as string).href,...client,...(o.scope?{scope:o.scope as string}:{})}}
      }else throw Error(tm('errPlugin.manifest.e23'))
    } catch(error) {errors.push(error instanceof Error?error.message:tm('errPlugin.manifest.e24'))}
  } else {
    if(mcpRaw?.transport!==undefined&&mcpRaw.transport!=='stdio')errors.push(tm('errPlugin.manifest.e25'))
    if (!command) errors.push(tm('errPlugin.manifest.e26'))
  }
  const argsRaw = Array.isArray(mcpRaw?.args) ? mcpRaw!.args : []
  const args: string[] = []
  for (const a of argsRaw) {
    if (typeof a !== 'string') {
      errors.push(tm('errPlugin.manifest.e27'))
      break
    }
    // `./server.mjs` 这类相对路径按插件目录解开；`..` 一律拒
    if (a.startsWith('./') || a.startsWith('../')) {
      if (!insideDir(a)) {
        errors.push(tm('errPlugin.manifest.e28',{a}))
        break
      }
      args.push(path.join(dir, a))
    } else args.push(a)
  }
  const envRaw = rec(mcpRaw?.env) ?? {}
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(envRaw)) {
    if (typeof v === 'string') env[k] = v
    else warnings.push(tm('errPlugin.manifest.e29',{k}))
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
      errors.push(tm('errPlugin.manifest.e30'))
      continue
    }
    if (seen.has(id)) {
      errors.push(tm('errPlugin.manifest.e31',{id}))
      continue
    }
    seen.add(id)
    if (!entry || !(entry.startsWith('ui://') || insideDir(entry))) {
      errors.push(tm('errPlugin.manifest.e32',{id}))
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
      defaultSize: { w: clamp(size?.w, 460), h: clamp(size?.h, 340) },
      // 只认 true：隐藏面板不进任何面板选择，只供宿主按 panelId 嵌入（分屏头条）
      ...(pr?.hidden === true ? { hidden: true } : {})
    })
  }

  if (config?.startup === 'deferred') {
    if (remote) errors.push(tm('errPlugin.manifest.e33'))
    if (!panels.length) errors.push(tm('errPlugin.manifest.e34'))
  }

  // permissions.canvas：和宿主全局白名单取交集，不认识的丢掉记 warning
  const permRaw = rec(m.permissions)
  const canvasReq = Array.isArray(permRaw?.canvas) ? permRaw!.canvas : []
  const canvas: string[] = []
  for (const t of canvasReq) {
    if (typeof t !== 'string') continue
    if ((CANVAS_CALL_ALLOWLIST as readonly string[]).includes(t)) canvas.push(t)
    else warnings.push(tm('errPlugin.manifest.e35',{t}))
  }

  const brand = str(m.brandColor)
  if (brand && !HEX_RE.test(brand)) warnings.push(tm('errPlugin.manifest.e36'))

  const iconRel = str(m.composerIcon) ?? str(m.logo)
  let iconPath: string | undefined
  if (iconRel) {
    if (!insideDir(iconRel)) warnings.push(tm('errPlugin.manifest.e37'))
    else {
      const abs = path.join(dir, iconRel)
      if (!opts.exists || opts.exists(abs)) iconPath = abs
      else warnings.push(tm('errPlugin.manifest.e38'))
    }
  }

  if (errors.length) return { ok: false, errors }
  const requirements = parsePluginRequirements(m.requirements)
  const info: PluginInfo = {
    id: `eas:${name}`,
    cli: 'eas',
    name: name!,
    version: pluginVersion(m.version),
    requirements: requirements.ok ? requirements.requirements : undefined,
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
    permissions: { canvas, events: Array.isArray(rec(m.permissions)?.events) ? (rec(m.permissions)!.events as unknown[]).filter((x): x is string => x === 'agent.turn.completed') : [], ...(rec(m.permissions)?.split === true ? { split: true } : {}) },
    mcp: remote ? undefined : { command: command!, args, env, cwd: dir },
    remote,
    config,
    builtin: !!opts.builtin,
    // 只认随包内置：用户目录/市场安装的插件声明 system 一律忽略，防止第三方把自己从「我的插件」里藏起来
    ...(opts.builtin && m.system === true ? { system: true } : {})
  }
  return { ok: true, info, warnings }
}
