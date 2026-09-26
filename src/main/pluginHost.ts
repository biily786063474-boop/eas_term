import {jevTimelineReady} from './pluginConnections/jevTimeline.ts'
import {activateDeferredConfiguration} from './pluginConnections/deferredConfiguration.ts'
import {startupConfiguration} from './pluginConnections/configurationStartup.ts'
import { connectPluginConfiguration, connectPluginBearer } from './pluginConfiguration'
import { getPluginAuthorization } from './pluginAuthorization'
import { RemotePluginClient } from './pluginConnections/remoteClient.ts'
import { createPluginNetwork } from './pluginConnections/pluginNetwork.ts'
import { guardedHandle } from './ipcGuard'
import {createToolActivity} from './runtime/toolActivity.ts'
import { runtimeStateStore } from './runtime/persistentState.ts'
import { createManualStopLatch } from './runtime/manualStop.ts'
import { stopHost } from './runtime/stopHost.ts'
import { projectServiceOwners, canStopHostRefs } from './runtime/serviceProjection.ts'
import type { RuntimeObservedService } from '../shared/runtimeResources.ts'
import { watchPluginFiles } from './pluginLifecycle.ts'
import { initPluginEvents, eventPanel, eventProjects, invalidatePluginEvents, eventGrantFile, eventGrantEpoch } from './pluginEventHost.ts'
import { markPluginTurnRecorded } from './pluginEvents.ts'
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
import { app, protocol, webContents, BrowserWindow, dialog, session } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HostRegistry } from './hostRegistry.ts'
import { startManagedSession } from './runtime/sessionStartup.ts'
import { BuiltinCapabilityHost, type BuiltinHosted } from './builtinCapabilityHost.ts'
import { McpClient, type McpToolDef } from './mcpClient.ts'
import { preparePanelHtml } from './panelHtml.ts'
import { recipients } from './panelFanout.ts'
import { findPlugin, pluginIdEnabled } from './plugins'
import { panelCanvasCapabilities, panelMayCallCanvas, type PanelSurfaceContext } from '../shared/pluginPanelSurface.ts'
import { resolveCommand } from './nodeBin.ts'
import { PROBE_ENV } from './probeEnv'
import { CANVAS_CALL_ALLOWLIST, JSONRPC_INVALID_PARAMS, JSONRPC_METHOD_NOT_FOUND } from '../shared/pluginProtocol.ts'
import type { PluginInfo } from '../shared/types'
import { guardDir, guardPath } from './fsGuard.ts'
import { timelineRuntime, timelineGuidance } from './timelineRuntime.ts'
import { projectRootOf } from '../shared/roleWorktree.ts'
import type { CapabilityContext, CapabilityLease } from './capabilitySessions.ts'
import { authorizePlanCall, allowedPlanPanelMethod, planShimMayCall, preparePlanPanelParams, preparePlanToolParams } from './executionPlanAuthorization.ts'
import { activePlanTurn, notePlanReceipt, publishPlanEvent } from './agentChat/executionPlanTurns.ts'

export const PLUGIN_SCHEME = 'eas-plugin'
const manualStops=createManualStopLatch({load:()=>runtimeStateStore.read().stoppedPlugins,save:stoppedPlugins=>runtimeStateStore.write({...runtimeStateStore.read(),stoppedPlugins})})

interface Hosted {
  startedAt: number
  kind: 'plugin'
  name: string
  info: PluginInfo
  client: McpClient | RemotePluginClient
  /** Process exit for stdio, local connection shutdown for remote (not upstream cancellation). */
  stopped: Promise<void>
  tools: McpToolDef[]
  configurationActive?: boolean
  configurationConnecting?: boolean
  stopWatching?: () => void
  ready: Promise<void>
}

export interface PanelCtx extends PanelSurfaceContext {
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
  stale?: boolean
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

const registry = new HostRegistry<Hosted | BuiltinHosted>({
  graceMs: GRACE_MS,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  onIdle: (name, h) => {
    console.log(`[plugin] ${name} 没人用了，回收进程`)
    if (h.kind === 'builtin') h.close()
    else { h.stopWatching?.(); h.client.close() }
  }
})
/** Main-only binding API, not exposed through plugin RPC or renderer IPC. */
export const builtinCapabilityHost = new BuiltinCapabilityHost<Hosted>(registry)

const panels = new Map<string, Panel>()
let jevSuggestionsPending=0
const shims = new Map<string, Shim>()
const toolActivity=createToolActivity(()=>performance.now())
export const installPluginAdmission=toolActivity.setAdmission
export const observedPluginTasks=toolActivity.list
export const cancelPluginTask=toolActivity.cancel

/** 某个插件的数据目录（userData/plugin-data/<名>/）。宿主负责建，插件只管用。 */
function pluginDataDir(name: string): string {
  const d = path.join(app.getPath('userData'), 'plugin-data', name)
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {
    /* 建不出来插件那边会自己退回临时目录 */
  }
  return d
}

function spawnHosted(info: PluginInfo): Hosted {
  let client: McpClient | RemotePluginClient
  let stopped: Promise<void>
  if(info.remote){
    const authorization=info.remote.auth==='oauth'?getPluginAuthorization(info).connect():info.remote.auth==='bearer'?connectPluginBearer(info,createPluginNetwork(info.remote.approvedOrigins,session.defaultSession)):undefined
    const remoteClient=new RemotePluginClient({url:info.remote.url,approvedOrigins:info.remote.approvedOrigins,version:app.getVersion(),fetch:authorization?.fetch??createPluginNetwork(info.remote.approvedOrigins,session.defaultSession)})
    client=remoteClient
    stopped=remoteClient.connectionClosed
    if(authorization){
      const revoke=()=>{void remoteClient.close()}
      authorization.signal.addEventListener('abort',revoke,{once:true})
      if(authorization.signal.aborted)revoke()
      void stopped.then(()=>{authorization.signal.removeEventListener('abort',revoke);authorization.close()})
    }
  } else {
  if (!info.mcp) throw new Error(`插件 ${info.name} 没有 mcp 启动方式`)
  // 裸 `node` 在 Dock 启动的 app 里 spawn 不到（PATH 贫瘠）—— 2026-09-05 正式版事故。
  // 解析走 nodeBin.ts（和 MCP shim 同一份规则）；PATH 用探过登录 shell 的 PROBE_ENV。
  const run = resolveCommand(info.mcp.command, info.mcp.args)
  const env: Record<string, string> = {
    PATH: PROBE_ENV.PATH ?? process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...(process.platform === 'win32' && process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(run.env ?? {}),
    // 插件要往 userData 下写东西时的落点（今天只有「电脑视野」的截图用）。
    // 由宿主给，插件自己不该去猜 userData 在哪。
    EAS_PLUGIN_DATA: pluginDataDir(info.name),
    EAS_COMPUTER_SHOTS: path.join(pluginDataDir(info.name), 'shots'),
    ...info.mcp.env,
    EAS_EVENT_GRANTS_FILE: eventGrantFile(),
    EAS_EVENT_PLUGIN_NAME: info.name
  }
  const configuration=startupConfiguration(info.config,()=>connectPluginConfiguration(info))
  try{
    if(configuration)env.EAS_PLUGIN_CONFIG=configuration.environment
    client = new McpClient({ name: info.name, command: run.command, args: run.args, env, cwd: info.mcp.cwd, suppressStderr:!!info.config })
  }catch(error){configuration?.close();throw error}
  finally{delete env.EAS_PLUGIN_CONFIG;if(configuration)configuration.environment=''}
  stopped=client.exited
  if(configuration){
    const revoke=()=>{client.close()}
    configuration.signal.addEventListener('abort',revoke,{once:true})
    if(configuration.signal.aborted)revoke()
    void stopped.then(()=>{configuration.signal.removeEventListener('abort',revoke);configuration.close()})
  }
  }
  const hosted: Hosted = { startedAt: performance.now(), kind: 'plugin', name: info.name, info, client, stopped, tools: [], ready: Promise.resolve() }
  hosted.ready = (async () => {
    await client.initialize(app.getVersion())
    hosted.tools = await client.listTools()
  })()
  hosted.ready.catch((e) => console.error(`[plugin] ${info.name} 握手失败`, info.config?'配置插件握手失败（原始诊断已隐藏）':e))
  const onEnded = () => {
    hosted.stopWatching?.()
    if (registry.get(info.name) !== hosted) return
    registry.drop(info.name, hosted)
    // 进程没了，挂在它上面的面板要知道（渲染层显示「插件进程退出」并给重开）
    for (const p of panels.values()) if (p.pluginName === info.name) notifyPanel(p, 'ui/resource-teardown', { reason: info.remote ? 'connection-closed' : 'process-exit' })
  }
  if(client instanceof RemotePluginClient)client.onClose=onEnded
  else client.onExit=onEnded
  client.onNotification = (method, params) => {
    if (registry.get(info.name) !== hosted) return
    // server 主动通知（如 notifications/resources/updated）→ 转给这个插件的所有面板
    for (const p of panels.values()) if (p.pluginName === info.name) notifyPanel(p, method, params)
  }
  try { hosted.stopWatching = watchPluginFiles(info.root, () => retirePlugin(hosted, 'plugin-files-changed')) }
  catch (e) { client.close(); throw e }
  return hosted
}

function retirePlugin(h: Hosted, reason: string): void {
  if (registry.get(h.name) !== h) return
  invalidatePluginEvents(h.name)
  registry.drop(h.name, h)
  h.stopWatching?.()
  for (const p of panels.values()) if (p.pluginName === h.name) {
    p.stale = true
    notifyPanel(p, 'ui/resource-teardown', { reason })
  }
  for (const [id, shim] of shims) if (shim.pluginName === h.name) shims.delete(id)
  h.client.close()
}


/** 插件服务器进程的首版启动预留：一个 node 进程 + 握手。不是实测峰值，不是硬上限。 */
const PLUGIN_START_COST = { cpu: 5, memoryBytes: 256 * 1024 ** 2 }
/** 并发面板 / shim 合并启动，所有 ref 仍由 HostRegistry 管理。 */
const startingPlugins = new Map<string, Promise<void>>()
const packageMutations = new Set<string>()

const PLAN_CARD_METHODS = new Set(['host/card-read', 'host/card-accept', 'host/card-complete', 'host/card-terminate'])
/** Main-only bridge. Never exposed through the model shim or panel RPC. */
export async function requestExecutionPlanCard(method: string, trusted: { root: string; ownerKey: string }, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!PLAN_CARD_METHODS.has(method)) throw Error('未知执行清单卡片方法')
  const info = findPlugin('eas:execution-plan')
  if (!info || info.name !== 'execution-plan' || !pluginIdEnabled(info.id)) throw Error('执行清单插件未启用或已卸载')
  const checked = guardDir(projectRootOf(trusted.root))
  if (!checked.ok) throw Error(checked.error)
  const target = guardPath(path.join(checked.path, '.eas', 'execution-plans.json'))
  if (!target.ok) throw Error(target.error)
  if (method === 'host/card-read' && !fs.existsSync(target.path)) return null
  if (!/^(node|session):[^:]+$/.test(trusted.ownerKey)) throw Error('执行清单归属无效')
  const ref = `card:${crypto.randomUUID()}`
  try {
    const h = await acquire(info, ref)
    if (!pluginIdEnabled(info.id) || findPlugin(info.id)?.root !== info.root || registry.get(info.name) !== h) throw Error('执行清单插件已关闭或替换')
    const result = await h.client.request(method, { ...args, _meta: { eas: { context: { cwd: checked.path, ownerKey: trusted.ownerKey } } } }, 30_000)
    if (!pluginIdEnabled(info.id) || findPlugin(info.id)?.root !== info.root || registry.get(info.name) !== h) throw Error('执行清单插件已关闭或替换')
    return result
  } finally { registry.release(info.name, ref) }
}

/** 插件启动直达执行，不进全局等待队列（2026-09-22 用户要求）。
 * 保留预算记账、共享进程、手动停止保护；预算随真实 stopped 释放。
 * immediate 仅由主进程声明，不接受插件 RPC/渲染层传参。 */
async function acquire(info: PluginInfo, ref: string): Promise<Hosted> {
  if(packageMutations.has(info.name))throw Error('插件正在更新或卸载，请稍后重新打开')
  if (info.config && info.remote && info.remote.auth!=='bearer') throw Error('远程插件配置注入尚未接通，不能启动')
  const previous=registry.get(info.name)
  if(previous?.kind==='plugin'&&previous.info.root!==info.root)retirePlugin(previous,'plugin-replaced')
  if(manualStops.stamp(info.name)!==null)throw new Error('服务已由用户关闭；请在插件面板点击重试并确认重新启动')
  if (!registry.get(info.name)) {
    let starting = startingPlugins.get(info.name)
    if (!starting) {
      starting = startManagedSession<void>({
        id: 'plugin-start:' + info.name, windowId: null, name: '插件 ' + info.displayName + ' 启动', immediate: true, projectId: null, cost: PLUGIN_START_COST,
        start: async signal => {
          if (signal.aborted) throw new Error('插件启动已取消')
          if(packageMutations.has(info.name))throw Error('插件正在更新或卸载，请稍后重新打开')
          if (manualStops.stamp(info.name) !== null) throw new Error('服务已由用户关闭；请在插件面板点击重试并确认重新启动')
          const started = registry.acquire(info.name, ref, () => spawnHosted(info))
          return { value: undefined, completed: started.kind === 'plugin' ? started.stopped : Promise.resolve() }
        }
      }).finally(() => { if (startingPlugins.get(info.name) === starting) startingPlugins.delete(info.name) })
      startingPlugins.set(info.name, starting)
    }
    await starting
  }
  // 准入回调里已经 spawn 过；这里只登记 ref。进程若在这一瞬间已死（onExit→drop），不能绕过准入再起一个。
  const h = registry.acquire(info.name, ref, () => { throw new Error(`插件 ${info.name} 的进程起不来或已退出`) })
  if (h.kind !== 'plugin') throw new Error('插件身份冲突')
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

/** Timeline is a project writer: authorize at the host before handing cwd to stdio. */
function timelineParams(params: Record<string, unknown>, cwd: unknown): Record<string, unknown> {
  const checked = guardDir(cwd)
  if (!checked.ok) throw new Error(checked.error)
  const root = guardDir(projectRootOf(checked.path))
  if (!root.ok) throw new Error(root.error)
  const file = guardPath(path.join(root.path, '.eas', 'timeline.json'))
  if (!file.ok) throw new Error(file.error)
  const full = withEasMeta(params, { cwd: root.path }); (full._meta as Record<string, unknown>).projects = eventProjects('timeline'); return full
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
  if (args.ctx.surface === 'popup' && !pluginIdEnabled(info.id)) return {ok:false,error:'插件已关闭，先在抽屉里开启'}
  const panel = info.panels?.find((p) => p.id === args.panelId)
  if (!panel) return { ok: false, error: `插件「${info.displayName}」没有面板 ${args.panelId}` }
  const session = crypto.randomBytes(12).toString('hex')
  const ref = `panel:${session}`
  try {
    const h = await acquire(info, ref)
    // Installation/enablement can change while the plugin process starts.
    if (args.ctx.surface === 'popup' && (!pluginIdEnabled(info.id) || findPlugin(info.id)?.root !== info.root)) {
      registry.release(info.name, ref)
      return { ok: false, error: '插件已关闭或更新，请重新打开' }
    }
    const html = await readEntry(h, info, panel.entry)
    const prep = preparePanelHtml(html)
    if (!prep.ok) {
      registry.release(info.name, ref)
      return { ok: false, error: prep.why }
    }
    panels.set(session, { session, pluginName: info.name, panelId: panel.id, ctx: args.ctx, webContentsId: wcId, html: prep.html, headers: prep.headers })
    return { ok: true, panelSession: session, url: `${PLUGIN_SCHEME}://${session}/`, tools: h.tools, canvasAllow: panelCanvasCapabilities(args.ctx, info.permissions?.canvas ?? []), title: panel.title, version: app.getVersion() }
  } catch (e) {
    registry.release(info.name, ref)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function panelClose(session: string): void {
  const p = panels.get(session)
  if (!p) return
  toolActivity.closeSource(`panel:${session}`)
  panels.delete(session)
  registry.release(p.pluginName, `panel:${session}`)
}

type RpcResult = { ok: true; result: unknown } | { ok: false; code: number; error: string }

async function panelRpc(args: { panelSession: string; method: string; params: unknown }): Promise<RpcResult> {
  const p = panels.get(args.panelSession)
  if (!p || p.stale) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '面板已失效，请重新打开插件' }
  const h = registry.get(p.pluginName)
  if (!h || h.kind !== 'plugin' || !h.client.alive) return { ok: false, code: -32603, error: '插件进程不在' }
  const installed = findPlugin('eas:' + p.pluginName)
  if (!installed || installed.root !== h.info.root) {
    retirePlugin(h, 'plugin-removed-or-replaced')
    return { ok: false, code: -32603, error: '插件已卸载或替换，请重新打开' }
  }
  if (p.ctx.surface === 'popup' && !pluginIdEnabled(installed.id)) {
    panelClose(p.session)
    return {ok:false,code:JSONRPC_INVALID_PARAMS,error:'插件已关闭，弹窗面板已退出'}
  }
    const params = (args.params ?? {}) as Record<string, unknown>
  try {
    if (p.pluginName === 'execution-plan' && allowedPlanPanelMethod(args.method)) {
      if (!pluginIdEnabled(installed.id)) throw Error('执行清单插件已停用')
      const checked = guardDir(projectRootOf(p.ctx.cwd))
      if (!checked.ok) throw Error(checked.error)
      const target = guardPath(path.join(checked.path, '.eas', 'execution-plans.json'))
      if (!target.ok) throw Error(target.error)
      const result = await h.client.request(args.method, preparePlanPanelParams(params, checked.path), 30_000)
      if (p.stale || panels.get(p.session) !== p || registry.get(p.pluginName) !== h) throw Error('原执行清单面板已失效')
      if (['panel/accept', 'panel/update', 'panel/archive'].includes(args.method)) broadcastToolResult(p.pluginName, args.method, params, result, p.session)
      return { ok: true, result }
    }
    switch (args.method) {
      case 'panel/configuration': {
        if (!h.info.config) throw Error('插件没有连接设置')
        const observed = observedPluginServices(p.webContentsId).find(service => service.id.startsWith('plugin:' + p.pluginName + ':'))
        if (!observed) throw Error('插件状态已改变')
        const stopped = await stopObservedPlugin(observed.id, p.webContentsId, async name => {
          const wc = webContents.fromId(p.webContentsId)
          const owner = wc ? BrowserWindow.fromWebContents(wc) : null
          if (!owner) return false
          const answer = await dialog.showMessageBox(owner, { type: 'question', title: '打开安全连接设置', message: `先停止「${name}」再修改连接信息？`, detail: '停止后不能发起新调用。保存后重新打开插件并验证连接；其他窗口或对话占用时不能强制停止。', buttons: ['取消', '停止并设置'], defaultId: 0, cancelId: 0 })
          return answer.response === 1
        })
        if (!stopped.ok) throw Error(stopped.reason)
        await h.stopped
        assertPluginPackageIdle(p.pluginName)
        return { ok: true, result: { pluginId: h.info.id } }
      }
      case 'panel/timeline-report': {
        if(p.pluginName!=='timeline')throw Error('仅时间线插件支持成果周报')
        if(params.week!==undefined&&params.week!==0&&params.week!==-1)throw Error('仅支持本周或上周')
        const authorized=timelineParams({week:params.week??0,projectIds:params.projectIds},p.ctx.cwd)
        const result=await h.client.request(args.method,authorized)
        if(p.stale||panels.get(p.session)!==p||registry.get(p.pluginName)!==h)throw Error('原时间线面板已失效')
        return {ok:true,result}
      }
      case 'ping':
        return { ok: true, result: {} }
      // 插件的**面板私有方法**（`panel/` 前缀）：只有面板走得到，会话里的转发 shim 那条路
      // 不认这个前缀（见 pluginRpcFromShim 的 switch）。用途是「只有用户真手点才能做的事」——
      // 电脑操作的授权就是这样：工具面里根本没有 grant，模型给自己授权是不可能的。
      case 'panel/grant':
      case 'panel/revoke':
      case 'panel/state':
        if (h.info.permissions?.events?.includes('agent.turn.completed')) return { ok: true, result: eventPanel(p.pluginName, args.method, params) }
        if (h.info.config?.startup === 'deferred' && args.method === 'panel/grant' && params.action === 'connect') {
          if (h.configurationActive || h.configurationConnecting) throw Error('连接已建立或正在验证')
          h.configurationConnecting = true
          try {
            const wc = webContents.fromId(p.webContentsId)
            const owner = wc ? BrowserWindow.fromWebContents(wc) : null
            if (!owner) throw Error('原窗口已关闭')
            const confirmation = await dialog.showMessageBox(owner, { type: 'question', title: '验证插件连接', message: `允许「${h.info.displayName}」使用已保存的连接信息进行一次服务验证？`, detail: '验证可能产生少量服务费用；不会发送项目内容。验证成功后仍需单独开启能力。', buttons: ['取消', '验证连接'], defaultId: 0, cancelId: 0 })
            if (confirmation.response !== 1) throw Error('已取消连接验证')
            const valid = () => !p.stale && panels.get(p.session) === p && registry.get(p.pluginName) === h && h.client.alive
            if (!valid()) throw Error('原面板已失效')
            await activateDeferredConfiguration({ connect: () => connectPluginConfiguration(h.info), request: (method, params) => h.client.request(method, params, 30_000), valid, stop: () => { h.client.close() }, stopped: h.stopped })
            h.configurationActive = true
            return { ok: true, result: { ...await h.client.request('panel/state', {}) as object, timelineReady: jevTimelineReady(findPlugin('eas:timeline')?.version) } }
          } finally { h.configurationConnecting = false }
        }
        {
          const result = await h.client.request(args.method, { ...params, by: p.session }, 30_000)
          if (h.info.config?.startup === 'deferred' && args.method !== 'panel/state') h.tools = await h.client.listTools()
          return { ok: true, result: p.pluginName==='jev'?{...result as object,timelineReady:jevTimelineReady(findPlugin('eas:timeline')?.version)}:result }
        }
      case 'panel/resolve-candidate': {
        if (p.pluginName !== 'timeline') throw Error('不支持的候选操作')
        const authorized=timelineParams(params, p.ctx.cwd)
        const project=eventProjects('timeline').find(x=>x.id===params.projectId)
        if(!project)throw Error('项目未授权')
        for(const file of ['timeline.json','timeline-candidates.json']){const checked=guardPath(path.join(project.cwd,'.eas',file));if(!checked.ok)throw Error(checked.error)}
        const result = await h.client.request(args.method, authorized)
        broadcastToolResult(p.pluginName, 'timeline_capture', {}, result, null)
        return {ok:true,result}
      }
      case 'tools/call': {
        const name = String(params.name ?? '')
        if (!h.tools.some((t) => t.name === name)) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: `本插件没有工具 ${name}` }
        const full = p.pluginName === 'timeline'
          ? timelineParams({ name, arguments: params.arguments ?? {} }, p.ctx.cwd)
          : withEasMeta({ name, arguments: params.arguments ?? {} }, p.ctx)
        const result = await toolActivity.track({id:crypto.randomUUID(),name:p.pluginName+' / '+name,projectId:p.ctx.projectId,windowId:p.webContentsId,sourceKey:`panel:${p.session}`},()=>{if(panels.get(p.session)!==p||registry.get(p.pluginName)!==h||!h.client.alive)throw Error('原面板或插件已关闭，排队任务不再执行');return h.client.requestTracked('tools/call', full, 10 * 60 * 1000)})
        broadcastToolResult(p.pluginName, name, params.arguments ?? {}, result, p.session)
        return { ok: true, result }
      }
      case 'resources/read': {
        const uri = String(params.uri ?? '')
        if (!uri.startsWith('ui://')) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '面板只能读 ui:// 资源' }
        return { ok: true, result: await h.client.request('resources/read', { uri }) }
      }
      case 'eas/canvas.call': {
        if (!panelMayCallCanvas(p.ctx)) return {ok:false,code:JSONRPC_METHOD_NOT_FOUND,error:'弹窗面板没有画布节点权限'}
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
  timelineSession?: string
  planLease?: CapabilityLease
  method?: string
  params?: unknown
}, planCaller?: { identity: CapabilityContext; revalidate: () => CapabilityContext }): Promise<RpcResult> {
  const name = String(body.plugin ?? '')
  const shimId = String(body.shimId ?? '')
  if (!name || !shimId) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '缺 plugin / shimId' }
  const info = findPlugin(`eas:${name}`)
  if (!info || info.cli !== 'eas') return { ok: false, code: JSONRPC_INVALID_PARAMS, error: `没有插件 ${name}` }
  if (name === 'execution-plan' && (!planCaller || !pluginIdEnabled(info.id))) return { ok: false, code: JSONRPC_INVALID_PARAMS, error: '执行清单插件未授权或已关闭' }
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
          serverInfo: { name: `eas-plugin-${h.name}`, version: app.getVersion() },
          ...(name === 'timeline' ? { instructions: timelineGuidance('eas:timeline') } : {})
        }
      }
    }
    const h = registry.get(name)
    if (!h || h.kind !== 'plugin' || !h.client.alive) return { ok: false, code: -32603, error: '插件进程不在（先 initialize）' }
    if (h.info.root !== info.root) { retirePlugin(h,'plugin-replaced'); return { ok:false, code:-32603, error:'插件已替换，请重新 initialize' } }
    if (!shims.has(shimId) || shims.get(shimId)!.pluginName !== name) return { ok: false, code: -32603, error: '插件连接已失效，请重新 initialize' }
    shims.get(shimId)!.lastBeat = Date.now()
    if (name === 'execution-plan' && !planShimMayCall(String(body.method ?? ''), { enabled: pluginIdEnabled(info.id), sameRoot: h.info.root === info.root, live: h.client.alive })) return { ok: false, code: JSONRPC_METHOD_NOT_FOUND, error: '执行清单方法不可用' }
    switch (body.method) {
      case 'tools/list':
        return { ok: true, result: { tools: h.tools } }
      case 'tools/call': {
        const toolName = String(params.name ?? '')
        const planIdentity = name === 'execution-plan' ? planCaller!.identity : null
        const planTurn = planIdentity?.agentSessionId ? activePlanTurn(planIdentity.agentSessionId) : null
        const checkedRoot = planIdentity?.project ? guardDir(projectRootOf(planIdentity.project)) : null
        let planContext: ReturnType<typeof authorizePlanCall> | null = null
        if (name === 'execution-plan') {
          if (!checkedRoot?.ok || !planTurn) throw Error('执行清单缺少有效项目或轮次')
          planContext = authorizePlanCall(planIdentity!, planTurn, checkedRoot.path, app.getPath('userData'))
        }
        if (planContext) { const target = guardPath(path.join(planContext.cwd, '.eas', 'execution-plans.json')); if (!target.ok) throw Error(target.error) }
        const full = name === 'timeline' ? timelineParams(params, body.project) : planContext ? preparePlanToolParams(params, planContext) : params
        const result = await toolActivity.track({id:crypto.randomUUID(),name:name+' / '+toolName,projectId:null,windowId:null,sourceKey:`shim:${shimId}`},()=>{
          if(shims.get(shimId)?.pluginName!==name||registry.get(name)!==h||!h.client.alive)throw Error('原会话或插件已关闭，排队任务不再执行')
          if (planContext) {
            if (!pluginIdEnabled(info.id) || findPlugin(info.id)?.root !== info.root) throw Error('执行清单插件已关闭或替换')
            const renewed = planCaller!.revalidate()
            const renewedContext = authorizePlanCall(renewed, activePlanTurn(planContext.sessionId), planContext.cwd, app.getPath('userData'))
            if (renewedContext.ownerKey !== planContext.ownerKey) throw Error('执行清单归属已变化')
            if (activePlanTurn(planContext.sessionId)?.turnId !== planContext.turnId) throw Error('执行清单原轮次已结束')
          }
          return h.client.requestTracked('tools/call', full, 10 * 60 * 1000)
        })
        if (name === 'timeline' && typeof body.timelineSession === 'string' && typeof body.project === 'string') { timelineRuntime.receipt(body.timelineSession, body.project, toolName, result); if (toolName === 'timeline_record' && !(result as {isError?:boolean})?.isError && typeof (result as {structuredContent?:{id?:string}})?.structuredContent?.id === 'string') markPluginTurnRecorded(body.timelineSession) }
        if (planContext && !((result as {isError?: boolean})?.isError)) {
          const receipt = (result as { structuredContent?: unknown }).structuredContent
          if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
            const plan = receipt as { planId?: unknown; version?: unknown; steps?: unknown }
            if (typeof plan.planId === 'string' && typeof plan.version === 'number' && Array.isArray(plan.steps)) {
              const event = notePlanReceipt(planContext.sessionId, planContext.turnId, {
                tool: toolName as 'plan_create' | 'plan_get' | 'step_update' | 'plan_archive',
                planId: plan.planId,
                version: plan.version,
                steps: plan.steps as { stepId: string; title: string; status: string }[]
              })
              if (event) publishPlanEvent(planContext.sessionId, event)
            }
          }
        }
        if (name !== 'execution-plan' || !(result as {isError?:boolean})?.isError) broadcastToolResult(name, toolName, params.arguments ?? {}, result, null)
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
  toolActivity.closeSource(`shim:${shimId}`)
  shims.delete(shimId)
  registry.release(s.pluginName, `shim:${shimId}`)
}

function sweepShims(): void {
  builtinCapabilityHost.sweep()
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
  initPluginEvents(name => !!findPlugin('eas:' + name)?.permissions?.events?.includes('agent.turn.completed'), async (name, event, project, signal) => {
    const info = findPlugin('eas:' + name)
    if (!info || signal.aborted) return
    if (name === 'timeline') { const checked=guardPath(path.join(project.cwd,'.eas','timeline-candidates.json')); if(!checked.ok)throw Error(checked.error) }
    const ref = 'event:' + crypto.randomUUID()
    try {
      const h = await acquire(info, ref)
      if (signal.aborted) return
      const result = await h.client.request('events/turn-completed', withEasMeta({ event, grantEpoch: eventGrantEpoch(name) }, { cwd: project.cwd }), 10000)
      if ((result as {isError?:boolean})?.isError) throw Error('插件候选写入失败')
      broadcastToolResult(name, 'timeline_capture', {}, result, null)
      if(name==='timeline'&&jevTimelineReady(h.info.version)&&(result as {captured?:boolean})?.captured&&jevSuggestionsPending<2){
        jevSuggestionsPending++
        void (async()=>{
        const jev=registry.get('jev'),jevInfo=findPlugin('eas:jev')
        if(jev?.kind==='plugin'&&jev.client.alive&&jevInfo?.enabled!==false&&jevInfo?.root===jev.info.root){
          try{
            const support=await h.client.request('host/jev-capabilities',{}) as {suggestions?:boolean}
            if(support.suggestions!==true)return
            const before=await jev.client.request('panel/state',{}) as {enabled:boolean;connected:boolean;generation:number;selected:{milestone:boolean;project:boolean}}
            if(before.enabled&&before.connected&&(before.selected.milestone||before.selected.project)&&!signal.aborted){
              // Existing timeline authorization defines the project boundary, never model-supplied paths.
              // @ts-expect-error standalone plugin library
              const {candidates}=await import('../../resources/plugins/timeline/lib/candidates.mjs')
              const id=(result as {id:string}).id,candidate=candidates(project.cwd).find((c:{id:string})=>c.id===id)
              const authorized=eventProjects('timeline')
              if(candidate&&!signal.aborted&&registry.get('jev')===jev&&jev.client.alive&&authorized.some(p=>p.id===project.id&&p.cwd===project.cwd)){
                const request=jev.client.requestTracked('host/timeline',{candidate,projects:authorized.slice(0,32).map(p=>({id:p.id,name:p.name}))},35000)
                const cancel=()=>request.cancel();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()
                let advice:unknown
                try{advice=await request.result}finally{signal.removeEventListener('abort',cancel)}
                const after=await jev.client.request('panel/state',{}) as {enabled:boolean;generation:number}
                if(!signal.aborted&&registry.get('jev')===jev&&after.enabled&&after.generation===before.generation&&eventProjects('timeline').some(p=>p.id===project.id&&p.cwd===project.cwd)){
                  const checked=guardPath(path.join(project.cwd,'.eas','timeline-candidates.json'));if(!checked.ok)throw Error(checked.error)
                  if(signal.aborted||registry.get(name)!==h||!h.client.alive)return
                  await h.client.request('host/attach-jev-suggestion',withEasMeta({id,advice,projectId:project.id,grantEpoch:eventGrantEpoch(name)},{cwd:project.cwd}),10000)
                  broadcastToolResult(name,'timeline_capture',{},result,null)
                }
              }
            }
          }catch{console.warn('[jev] 时间线建议未完成；原始候选保留，未自动重试')}
        }
        })().catch(()=>{console.warn('[jev] 可选建议已停止')}).finally(()=>{jevSuggestionsPending--})
      }

    } finally { registry.release(name, ref) }
  })
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
  guardedHandle('plugin:panelOpen', async (e, args: { pluginId: string; panelId: string; ctx: PanelCtx; resumeStopped?:boolean }) => {
    const win=BrowserWindow.fromWebContents(e.sender)
    if(!win||e.senderFrame!==e.sender.mainFrame)return {ok:false,error:'仅工作台可打开插件面板'}
    try {
    const info=findPlugin(args.pluginId),stamp=info?manualStops.stamp(info.name):null
    if(info&&stamp!==null&&args.resumeStopped===true){
      if(registry.get(info.name))return {ok:false,error:'服务仍在停止中，请稍后重试'}
      const result=await dialog.showMessageBox(win,{type:'question',title:'重新启动插件服务',message:'重新启动 '+info.displayName+'？',detail:'该服务之前已由你手动关闭。确认后重新启动，供此插件面板使用。',buttons:['取消','重新启动'],defaultId:0,cancelId:0})
      if(result.response!==1||win.isDestroyed())return {ok:false,error:'已取消重新启动'}
      if(!manualStops.resume(info.name,stamp))return {ok:false,error:'服务停止状态已变化，请重新确认'}
    }
    return await panelOpen(e.sender.id,args)
    } catch(error) { return {ok:false,error:error instanceof Error?error.message:String(error)} }
  })
  guardedHandle('plugin:panelClose', (_e, session: string) => {
    panelClose(String(session))
    return { ok: true }
  })
  guardedHandle('plugin:panelRpc', (_e, args: { panelSession: string; method: string; params: unknown }) => panelRpc(args))
  const t = setInterval(sweepShims, 15_000)
  t.unref()
  app.on('before-quit', () => {
    for (const name of registry.keys()) {
      const h = registry.drop(name)
      if (h?.kind === 'builtin') h.close()
      else if (h) { h.stopWatching?.(); h.client.close() }
    }
  })
}

/** Read-only projection of actual hosted plugin processes, not all app services.
 * Shim identities currently lack project metadata; preserve unknown ownership.
 */
export function observedPluginServices(callerWindowId:number):RuntimeObservedService[]{
  const windows=new Map([...panels.values()].map(p=>['panel:'+p.session,p.webContentsId] as const))
  const owners=new Map<string,string>()
  for(const panel of panels.values())if(panel.ctx.projectId)owners.set('panel:'+panel.session,panel.ctx.projectId)
  return registry.keys().flatMap(key=>{
    const hosted=registry.get(key),stamp=registry.leaseSnapshot(key)
    if(!hosted||hosted.kind!=='plugin'||!stamp)return []
    return [{id:'plugin:'+key+':'+stamp.generation,name:hosted.info.displayName,kind:'plugin' as const,
      ...projectServiceOwners(stamp.refs,owners),uptimeMs:Math.max(0,performance.now()-hosted.startedAt),
      state:hosted.client.alive?'running' as const:'stopping' as const,canStop:hosted.client.alive&&canStopHostRefs(stamp.refs,windows,callerWindowId)}]
  })
}

/** Confirmation is UI-owned; final authority is the actual host lease stamp. */
export async function stopObservedPlugin(serviceId:string,callerWindowId:number,confirm:(name:string,projects:readonly string[])=>Promise<boolean>):Promise<{ok:boolean;reason?:string}>{
 const find=()=>registry.keys().find(key=>{const stamp=registry.leaseSnapshot(key);return stamp&&'plugin:'+key+':'+stamp.generation===serviceId})
 const key=find();if(!key)return {ok:false,reason:'服务已退出或实例已改变'}
 const scope=()=>new Map([...panels.values()].map(p=>['panel:'+p.session,p.webContentsId] as const))
 return stopHost(registry,key,
  (host,refs)=>host.kind==='plugin'&&host.client.alive&&canStopHostRefs(refs,scope(),callerWindowId),
  host=>host.kind==='plugin'?confirm(host.info.displayName,observedPluginServices(callerWindowId).find(s=>s.id===serviceId)?.projectIds??[]):Promise.resolve(false),
  host=>{if(host.kind==='plugin')host.client.close()},
  host=>{if(host.kind==='plugin')manualStops.stop(host.name)})
}

/** Read-only explicit connectivity probe. Reuses managed admission and shared host. */
export async function testPluginConnection(info:PluginInfo):Promise<number>{
 const ref='test:'+crypto.randomUUID()
 try{
  const hosted=await acquire(info,ref)
  const tools=await hosted.client.listTools()
  return tools.length
 }finally{registry.release(info.name,ref)}
}

/** Synchronous disk mutation gate: do not replace files while any host or admission is live. */
export function assertPluginPackageIdle(name:string):void{
 if(startingPlugins.has(name)||registry.get(name))throw Error('插件仍在启动或运行，请先关闭相关会话/面板并等待释放，或在运行中心停止后重试')
}

/** Market-owned, per-plugin mutation fence. Never stops another plugin or an
 * unrelated app service. The decision is made in the owning workbench window;
 * a changed host lease during the dialog aborts rather than killing a new host. */
export async function withPluginPackageMutation<T>(name:string,confirm:(displayName:string,refs:number)=>Promise<boolean>,mutate:()=>T):Promise<T>{
 if(packageMutations.has(name))throw Error('该插件已有更新或卸载正在进行')
 packageMutations.add(name)
 try{
  const starting=startingPlugins.get(name)
  if(starting)await starting.catch(()=>{})
  const hosted=registry.get(name)
  if(hosted){
   if(hosted.kind!=='plugin')throw Error('此内置服务不可通过插件市场停止')
   const stamp=registry.leaseSnapshot(name)
   const result=await stopHost(registry,name,
    (host)=>host===hosted&&host.kind==='plugin'&&host.client.alive,
    host=>host.kind==='plugin'?confirm(host.info.displayName,stamp?.refs.length??0):Promise.resolve(false),
    host=>{if(host.kind==='plugin')host.client.close()})
   if(!result.ok)throw Error(result.reason??'插件未停止')
   let timer:NodeJS.Timeout|undefined
   try{await Promise.race([hosted.stopped,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('等待插件退出超时，未更改文件')),6000);timer.unref()})])}
   finally{if(timer)clearTimeout(timer)}
  }
  assertPluginPackageIdle(name)
  return mutate()
 }finally{packageMutations.delete(name)}
}
