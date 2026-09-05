// 插件面板的**宿主**：起插件进程（一个插件一个，面板与会话共用）、取面板 HTML、
// 面板桥的主进程半边、给转发 shim 的 RPC 入口、`eas-plugin://` 协议。
// 设计稿：docs/superpowers/specs/2026-09-05-插件面板宿主-design.md §H
//
// ── 进程模型 ──────────────────────────────────────────────────────────────
// hostRegistry 按插件名计数：面板打开 acquire('panel:<session>')，会话里的 shim 握手
// acquire('shim:<shimId>')；都释放后宽限 30s 再 kill。shim 靠心跳保活（45s 没心跳当它没了），
// 不依赖会话内部实现（核对结论 §八.4）。
//
// ── 安全 ──────────────────────────────────────────────────────────────────
// · 插件进程 env 里**没有** EAS_TERM_TOKEN：它要画布能力只能经面板桥的 eas/canvas.call，
//   那条路走 mcpHandler 同一执行体与路径白名单
// · 面板 HTML 走 eas-plugin://<panelSession>/，CSP 用响应头（panelHtml.ts）
// · 面板只能调**本插件** server 的工具；resources/read 只许 ui://
import { app, ipcMain, protocol, webContents } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HostRegistry } from './hostRegistry.ts'
import { McpClient, type McpToolDef } from './mcpClient.ts'
import { preparePanelHtml } from './panelHtml.ts'
import { recipients } from './panelFanout.ts'
import { findPlugin } from './plugins'
import { resolveCommand } from './nodeBin.ts'
import { PROBE_ENV } from './probeEnv'
import { CANVAS_CALL_ALLOWLIST, JSONRPC_INVALID_PARAMS, JSONRPC_METHOD_NOT_FOUND } from '../shared/pluginProtocol.ts'
import type { PluginInfo } from '../shared/types'

export const PLUGIN_SCHEME = 'eas-plugin'

interface Hosted {
  name: string
  info: PluginInfo
  client: McpClient
  tools: McpToolDef[]
  ready: Promise<void>
}

export interface PanelCtx {
  nodeId: string
  frameId: string
  projectId: string | null
  cwd: string
}

interface Panel {
  session: string
  pluginName: string
  panelId: string
  ctx: PanelCtx
  /** 打开它的渲染进程，通知往这里发 */
  webContentsId: number
  html: string
  headers: Record<string, string>
}

interface Shim {
  pluginName: string
  lastBeat: number
}

const SHIM_STALE_MS = 45_000
const GRACE_MS = 30_000

/** 画布工具的执行入口，由 index.ts 在注册时注入（mcpBridge 的 invokeRenderer）——
 *  这里不 import mcpBridge，否则和它 import 本模块成环 */
let invokeCanvas: ((tool: string, args: unknown, ctx: { project?: string }) => Promise<{ ok: boolean; data?: unknown; error?: string }>) | null = null

const registry = new HostRegistry<Hosted>({
  graceMs: GRACE_MS,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  onIdle: (name, h) => {
    console.log(`[plugin] ${name} 没人用了，回收进程`)
    h.client.close()
  }
})
const panels = new Map<string, Panel>()
const shims = new Map<string, Shim>()

function spawnHosted(info: PluginInfo): Hosted {
  if (!info.mcp) throw new Error(`插件 ${info.name} 没有 mcp 启动方式`)
  // 裸 `node` 在 Dock 启动的 app 里 spawn 不到（PATH 贫瘠）—— 2026-09-05 正式版事故。
  // 解析走 nodeBin.ts（和 MCP shim 同一份规则）；PATH 用探过登录 shell 的 PROBE_ENV。
  const run = resolveCommand(info.mcp.command, info.mcp.args)
  const env: Record<string, string> = {
    PATH: PROBE_ENV.PATH ?? process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...(process.platform === 'win32' && process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(run.env ?? {}),
    ...info.mcp.env
  }
  const client = new McpClient({ name: info.name, command: run.command, args: run.args, env, cwd: info.mcp.cwd })
  const hosted: Hosted = { name: info.name, info, client, tools: [], ready: Promise.resolve() }
  hosted.ready = (async () => {
    await client.initialize(app.getVersion())
    hosted.tools = await client.listTools()
  })()
  hosted.ready.catch((e) => console.error(`[plugin] ${info.name} 握手失败`, e))
  client.onExit = () => {
    registry.drop(info.name)
    // 进程没了，挂在它上面的面板要知道（渲染层显示「插件进程退出」并给重开）
    for (const p of panels.values()) if (p.pluginName === info.name) notifyPanel(p, 'ui/resource-teardown', { reason: 'process-exit' })
  }
  client.onNotification = (method, params) => {
    // server 主动通知（如 notifications/resources/updated）→ 转给这个插件的所有面板
    for (const p of panels.values()) if (p.pluginName === info.name) notifyPanel(p, method, params)
  }
  return hosted
}

async function acquire(info: PluginInfo, ref: string): Promise<Hosted> {
  const h = registry.acquire(info.name, ref, () => spawnHosted(info))
  await h.ready
  if (!h.client.alive) throw new Error(`插件 ${info.name} 的进程起不来或已退出`)
  return h
}

function notifyPanel(p: Panel, method: string, params: unknown): void {
  const wc = webContents.fromId(p.webContentsId)
  if (!wc || wc.isDestroyed()) return
  wc.send('plugin:panelNotify', { panelSession: p.session, method, params })
}

/** 一次 tools/call 完成 → 这个插件的面板收到 tool-result。**调用者面板自己不收**（panelFanout.ts：
 *  否则 refresh → tools/call → 广播 → refresh 无限循环，2026-09-05 真机撞到）。模型那边调的传 null。 */
function broadcastToolResult(pluginName: string, name: string, args: unknown, result: unknown, excludeSession: string | null): void {
  for (const p of recipients(panels.values(), pluginName, excludeSession)) notifyPanel(p, 'ui/notifications/tool-result', { name, arguments: args, result })
}

function withEasMeta(params: unknown, ctx: { cwd: string; frameId?: string; nodeId?: string; projectId?: string | null }): Record<string, unknown> {
  const p = params && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {}
  const meta = p._meta && typeof p._meta === 'object' ? { ...(p._meta as Record<string, unknown>) } : {}
  meta.eas = { context: ctx }
  p._meta = meta
  return p
}

async function readEntry(h: Hosted, info: PluginInfo, entry: string): Promise<string> {
  if (entry.startsWith('ui://')) {
    const r = (await h.client.request('resources/read', { uri: entry })) as { contents?: { text?: string; mimeType?: string; uri?: string }[] } | undefined
    const c = r?.contents?.[0]
    if (!c || typeof c.text !== 'string') throw new Error(`插件没有返回 ${entry} 的文本内容`)
    if (c.mimeType && !c.mimeType.startsWith('text/html')) throw new Error(`${entry} 不是 HTML（${c.mimeType}）`)
    return c.text
  }
  // 清单里已经校验过：只能是插件目录内的相对路径
  return fs.readFileSync(path.join(info.root, entry), 'utf8')
}

// ── 渲染层 IPC：面板 ────────────────────────────────────────────────────────
type PanelOpenResult =
  | { ok: true; panelSession: string; url: string; tools: McpToolDef[]; canvasAllow: string[]; title: string; version: string }
  | { ok: false; error: string }

async function panelOpen(wcId: number, args: { pluginId: string; panelId: string; ctx: PanelCtx }): Promise<PanelOpenResult> {
  const info = findPlugin(args.pluginId)
  if (!info || info.cli !== 'eas') return { ok: false, error: '找不到这个插件（可能已被移除）' }
  const panel = info.panels?.find((p) => p.id === args.panelId)
  if (!panel) return { ok: false, error: `插件「${info.displayName}」没有面板 ${args.panelId}` }
  const session = crypto.randomBytes(12).toString('hex')
  const ref = `panel:${session}`
  try {
    const h = await acquire(info, ref)
    const html = await readEntry(h, info, panel.entry)
    const prep = preparePanelHtml(html)
    if (!prep.ok) {
      registry.release(info.name, ref)
      return { ok: false, error: prep.why }
    }
    panels.set(session, { session, pluginName: info.name, panelId: panel.id, ctx: args.ctx, webContentsId: wcId, html: prep.html, headers: prep.headers })
    return { ok: true, panelSession: session, url: `${PLUGIN_SCHEME}://${session}/`, tools: h.tools, canvasAllow: info.permissions?.canvas ?? [], title: panel.title, version: app.getVersion() }
  } catch (e) {
    registry.release(info.name, ref)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function panelClose(session: string): void {
  const p = panels.get(session)
  if (!p) return
  panels.delete(session)
  registry.release(p.pluginName, `panel:${session}`)
}

type RpcResult = { ok: true; result: unknown } | { ok: false; code: number; error: string }

async function panelRpc(args: { panelSession: string; method: string; params: unknown }): Promise<RpcResult> {
  const p = panels.get(args.panelSession)
  if (!p) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '面板会话不存在' }
  const h = registry.get(p.pluginName)
  if (!h || !h.client.alive) return { ok: false, code: -32603, error: '插件进程不在' }
  const params = (args.params ?? {}) as Record<string, unknown>
  try {
    switch (args.method) {
      case 'ping':
        return { ok: true, result: {} }
      case 'tools/call': {
        const name = String(params.name ?? '')
        if (!h.tools.some((t) => t.name === name)) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: `本插件没有工具 ${name}` }
        const full = withEasMeta({ name, arguments: params.arguments ?? {} }, p.ctx)
        const result = await h.client.request('tools/call', full, 10 * 60 * 1000)
        broadcastToolResult(p.pluginName, name, params.arguments ?? {}, result, p.session)
        return { ok: true, result }
      }
      case 'resources/read': {
        const uri = String(params.uri ?? '')
        if (!uri.startsWith('ui://')) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '面板只能读 ui:// 资源' }
        return { ok: true, result: await h.client.request('resources/read', { uri }) }
      }
      case 'eas/canvas.call': {
        const tool = String(params.tool ?? '')
        const allow = h.info.permissions?.canvas ?? []
        // 双白名单：宿主全局 ∩ 清单声明
        if (!(CANVAS_CALL_ALLOWLIST as readonly string[]).includes(tool) || !allow.includes(tool))
          return { ok: false, code: JSONRPC_METHOD_NOT_FOUND, error: `插件未被允许调用 ${tool}` }
        if (!invokeCanvas) return { ok: false, code: -32603, error: '画布执行体未就绪' }
        const r = await invokeCanvas(tool, params.args ?? {}, { project: p.ctx.cwd })
        return r.ok ? { ok: true, result: r.data ?? null } : { ok: false, code: -32603, error: r.error ?? '调用失败' }
      }
      case 'ui/open-link': {
        const url = String(params.url ?? '')
        if (!/^https?:\/\//.test(url)) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '只能打开 http(s) 链接' }
        if (!invokeCanvas) return { ok: false, code: -32603, error: '画布执行体未就绪' }
        const r = await invokeCanvas('canvas_open_url', { url }, { project: p.ctx.cwd })
        return r.ok ? { ok: true, result: {} } : { ok: false, code: -32603, error: r.error ?? '打不开' }
      }
      default:
        return { ok: false, code: JSONRPC_METHOD_NOT_FOUND, error: `宿主不支持 ${args.method}` }
    }
  } catch (e) {
    const err = e as Error & { code?: number }
    return { ok: false, code: typeof err.code === 'number' ? err.code : -32603, error: err.message || String(e) }
  }
}

// ── 网关：转发 shim 的 RPC ─────────────────────────────────────────────────
export async function pluginRpcFromShim(body: {
  plugin?: string
  shimId?: string
  project?: string
  method?: string
  params?: unknown
}): Promise<RpcResult> {
  const name = String(body.plugin ?? '')
  const shimId = String(body.shimId ?? '')
  if (!name || !shimId) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '缺 plugin / shimId' }
  const info = findPlugin(`eas:${name}`)
  if (!info || info.cli !== 'eas') return { ok: false, code: JSONRPC_INVALID_PARAMS, error: `没有插件 ${name}` }
  const params = (body.params ?? {}) as Record<string, unknown>
  try {
    if (body.method === 'initialize') {
      const h = await acquire(info, `shim:${shimId}`)
      shims.set(shimId, { pluginName: name, lastBeat: Date.now() })
      return {
        ok: true,
        result: {
          protocolVersion: (params.protocolVersion as string) || '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: `eas-plugin-${h.name}`, version: app.getVersion() }
        }
      }
    }
    const h = registry.get(name)
    if (!h || !h.client.alive) return { ok: false, code: -32603, error: '插件进程不在（先 initialize）' }
    if (shims.has(shimId)) shims.get(shimId)!.lastBeat = Date.now()
    switch (body.method) {
      case 'tools/list':
        return { ok: true, result: { tools: h.tools } }
      case 'tools/call': {
        const toolName = String(params.name ?? '')
        const result = await h.client.request('tools/call', params, 10 * 60 * 1000)
        broadcastToolResult(name, toolName, params.arguments ?? {}, result, null)
        return { ok: true, result }
      }
      case 'resources/read':
      case 'resources/list':
        return { ok: true, result: await h.client.request(body.method, params) }
      default:
        return { ok: false, code: JSONRPC_METHOD_NOT_FOUND, error: `不支持 ${body.method}` }
    }
  } catch (e) {
    const err = e as Error & { code?: number }
    return { ok: false, code: typeof err.code === 'number' ? err.code : -32603, error: err.message || String(e) }
  }
}

export function pluginHeartbeat(shimId: string): void {
  const s = shims.get(shimId)
  if (s) s.lastBeat = Date.now()
}

export function pluginBye(shimId: string): void {
  const s = shims.get(shimId)
  if (!s) return
  shims.delete(shimId)
  registry.release(s.pluginName, `shim:${shimId}`)
}

function sweepShims(): void {
  const now = Date.now()
  for (const [id, s] of [...shims]) if (now - s.lastBeat > SHIM_STALE_MS) pluginBye(id)
}

// ── 注册 ──────────────────────────────────────────────────────────────────
/** 必须在 app ready **之前**调（同 easfile / bizone-media） */
export function registerPluginScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } }])
}

/** ready 之后调。`invoke` 是 mcpBridge 的 invokeRenderer —— 由调用方注入，避免成环 */
export function registerPluginHostHandlers(invoke: NonNullable<typeof invokeCanvas>): void {
  invokeCanvas = invoke
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    let session = ''
    try {
      session = new URL(request.url).host
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const p = panels.get(session)
    if (!p) return new Response('no such panel', { status: 404 })
    return new Response(p.html, { status: 200, headers: p.headers })
  })
  ipcMain.handle('plugin:panelOpen', (e, args: { pluginId: string; panelId: string; ctx: PanelCtx }) => panelOpen(e.sender.id, args))
  ipcMain.handle('plugin:panelClose', (_e, session: string) => {
    panelClose(String(session))
    return { ok: true }
  })
  ipcMain.handle('plugin:panelRpc', (_e, args: { panelSession: string; method: string; params: unknown }) => panelRpc(args))
  const t = setInterval(sweepShims, 15_000)
  t.unref()
  app.on('before-quit', () => {
    for (const name of registry.keys()) registry.drop(name)?.client.close()
  })
}
