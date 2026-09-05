// 面板桥的**判断层**：方法白名单、握手结果、`eas/canvas.call` 的双白名单、消息路由。
// **纯函数，不 import React / store。** 方法名的唯一出处是 shared/pluginProtocol.ts。
// 设计稿 §B。
import type { PluginPanelDef } from '../../../../shared/types'
import {
  APPS_PROTOCOL_VERSION,
  CANVAS_CALL_ALLOWLIST,
  HOST_TO_VIEW,
  JSONRPC_METHOD_NOT_FOUND,
  PANEL_SIZE_MAX,
  PANEL_SIZE_MIN,
  RESOURCE_URI_META_KEY,
  VIEW_NOTIFICATIONS,
  VIEW_REQUESTS
} from '../../../../shared/pluginProtocol.ts'

/** 面板拿到的上下文——和 CanvasComponentCtx 同形，故意不 import 它（那个文件是 tsx） */
export interface PanelCtx {
  nodeId: string
  frameId: string
  projectId: string | null
  cwd: string
}

export type ViewRequest = (typeof VIEW_REQUESTS)[number]
export type ViewNotification = (typeof VIEW_NOTIFICATIONS)[number]
export type HostMethod = (typeof HOST_TO_VIEW)[number]

export type Routed =
  | { kind: 'request'; id: number | string; method: ViewRequest; params: unknown }
  | { kind: 'notification'; method: ViewNotification; params: unknown }
  | { kind: 'drop'; why: string; id?: number | string }

/** 面板发来的一条 postMessage 该怎么处理。握手前只放 `ui/initialize` 与 `ping`。 */
export function routeViewMessage(msg: unknown, initialized: boolean): Routed {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { kind: 'drop', why: '不是对象' }
  const m = msg as Record<string, unknown>
  if (m.jsonrpc !== '2.0') return { kind: 'drop', why: '缺 jsonrpc:"2.0"' }
  const method = m.method
  if (typeof method !== 'string') return { kind: 'drop', why: '缺 method' }
  const hasId = typeof m.id === 'number' || typeof m.id === 'string'
  if (hasId) {
    if (!(VIEW_REQUESTS as readonly string[]).includes(method)) return { kind: 'drop', why: `未知方法 ${method}`, id: m.id as number | string }
    if (!initialized && method !== 'ui/initialize' && method !== 'ping') return { kind: 'drop', why: '未握手', id: m.id as number | string }
    return { kind: 'request', id: m.id as number | string, method: method as ViewRequest, params: m.params }
  }
  if (!(VIEW_NOTIFICATIONS as readonly string[]).includes(method)) return { kind: 'drop', why: `未知通知 ${method}` }
  return { kind: 'notification', method: method as ViewNotification, params: m.params }
}

/** `ui/initialize` 的响应。`_meta.eas` 是我们的扩展，别的宿主没有，面板要能没有它也跑。 */
export function initializeResult(
  ctx: PanelCtx,
  theme: 'dark' | 'light',
  canvasAllow: readonly string[],
  hostVersion: string
): Record<string, unknown> {
  return {
    protocolVersion: APPS_PROTOCOL_VERSION,
    hostInfo: { name: 'eas-term', version: hostVersion },
    hostCapabilities: {
      openLinks: {},
      serverTools: {},
      serverResources: {},
      experimental: { eas: { canvasCall: [...canvasAllow], panelResize: {} } }
    },
    hostContext: {
      theme,
      displayMode: 'inline',
      availableDisplayModes: ['inline'],
      _meta: { eas: { context: { ...ctx } } }
    }
  }
}

/** `eas/canvas.call` 双白名单：宿主全局允许集 ∩ 清单声明。少一边都不放。 */
export function canvasCallAllowed(tool: string, manifestAllow: readonly string[] | undefined, hostAllow: readonly string[] = CANVAS_CALL_ALLOWLIST): boolean {
  return hostAllow.includes(tool) && !!manifestAllow && manifestAllow.includes(tool)
}

/** 工具定义上的 UI 指针：先看 1.7.x 的 `_meta["ui/resourceUri"]`，再看老写法 `_meta.ui.resourceUri` */
export function resourceUriOfTool(tool: { _meta?: unknown }): string | null {
  const meta = tool._meta
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const flat = m[RESOURCE_URI_META_KEY]
  if (typeof flat === 'string' && flat.startsWith('ui://')) return flat
  const ui = m.ui
  if (ui && typeof ui === 'object') {
    const legacy = (ui as Record<string, unknown>).resourceUri
    if (typeof legacy === 'string' && legacy.startsWith('ui://')) return legacy
  }
  return null
}

/** 面板请求的尺寸夹在范围内；不是数字就用当前值 */
export function clampPanelSize(req: { w?: unknown; h?: unknown }, cur: { w: number; h: number }): { w: number; h: number } {
  const c = (v: unknown, d: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : d
    return Math.min(PANEL_SIZE_MAX, Math.max(PANEL_SIZE_MIN, Math.round(n)))
  }
  return { w: c(req.w, cur.w), h: c(req.h, cur.h) }
}

/** 这个面板的 entry 是不是要经 server 的 resources/read 取（否则主进程直接读盘） */
export function entryViaServer(p: Pick<PluginPanelDef, 'entry'>): boolean {
  return p.entry.startsWith('ui://')
}

export function errorResponse(id: number | string, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
export function methodNotFound(id: number | string, method: string): Record<string, unknown> {
  return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`)
}
export function resultResponse(id: number | string, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}
export function notification(method: HostMethod, params: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', method, params }
}
