// 插件面板：画布组件 `plugin-panel` 的渲染体。**插件身份在 ctx.props**（pluginId / panelId），
// 组件只注册这一个（设计稿决定 #5）。
//
// 生命周期：mount → plugin:panelOpen（主进程起/复用插件进程、取 HTML）→ sandbox iframe 指向
// eas-plugin://<panelSession>/ → 面板发 ui/initialize → 这里回握手结果 → 之后：
//   · 面板的请求经 appsProtocol 路由：本地能答的（ping / eas/panel.resize / size-changed）就地答，
//     其余转 plugin:panelRpc 给主进程（tools/call / resources/read / eas/canvas.call / open-link）
//   · 主进程的通知（tool-result / host-context-changed / teardown）经 onPanelNotify 转进 iframe
// unmount → plugin:panelClose（主进程减引用，归零宽限 30s 再回收进程）。
//
// 安全判据：只处理 `event.source === iframe.contentWindow` 的消息 —— iframe 是 sandbox 且没有
// allow-same-origin，origin 是 opaque（"null"），**不能拿 origin 当判据**（2026-09-05 核对 §八.3）。
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { getCanvasComponent, type CanvasComponentCtx } from '../canvas/components/registry'
import {
  clampPanelSize,
  errorResponse,
  initializeResult,
  methodNotFound,
  resultResponse,
  routeViewMessage,
  type PanelCtx
} from './appsProtocol.ts'

type State =
  | { k: 'loading' }
  | { k: 'error'; msg: string }
  | { k: 'ready'; session: string; url: string; canvasAllow: string[]; title: string; version: string }

function themeNow(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function PluginPanel({ ctx }: { ctx: CanvasComponentCtx }): JSX.Element {
  const pluginId = typeof ctx.props?.pluginId === 'string' ? ctx.props.pluginId : ''
  const panelId = typeof ctx.props?.panelId === 'string' ? ctx.props.panelId : 'main'
  const resizeNode = useStore((s) => s.resizeNode)
  const renameNode = useStore((s) => s.renameNode)
  const nodeName = useStore((s) => s.canvas.frames.find((x) => x.id === ctx.frameId)?.nodes.find((x) => x.id === ctx.nodeId)?.name)
  // ⚠️ **两个原始值 selector，不返回对象。** 返回 `{w,h}` 会让 zustand 每次都判「变了」→
  // 无限重渲染 → React #185（Maximum update depth）→ 整个界面进错误边界。2026-09-05 真机撞到：
  // 症状是「节点挂上就卸掉、30s 后插件进程被回收」，第一眼完全看不出是 selector 的锅。
  const nodeW = useStore((s) => s.canvas.frames.find((x) => x.id === ctx.frameId)?.nodes.find((x) => x.id === ctx.nodeId)?.w ?? 460)
  const nodeH = useStore((s) => s.canvas.frames.find((x) => x.id === ctx.frameId)?.nodes.find((x) => x.id === ctx.nodeId)?.h ?? 340)
  const nodeSize = { w: nodeW, h: nodeH }
  const [state, setState] = useState<State>({ k: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const initializedRef = useRef(false)
  const sessionRef = useRef<string | null>(null)
  const panelCtx: PanelCtx = { nodeId: ctx.nodeId, frameId: ctx.frameId, projectId: ctx.projectId, cwd: ctx.cwd }

  // 打开 / 关闭
  useEffect(() => {
    if (!pluginId) {
      setState({ k: 'error', msg: '这个节点没有指定插件 —— 从 Frame 双击菜单的「插件」里打开面板' })
      return
    }
    let live = true
    initializedRef.current = false
    setState({ k: 'loading' })
    void window.api.plugins.panelOpen({ pluginId, panelId, ctx: panelCtx }).then((r) => {
      if (!live) {
        if (r.ok) void window.api.plugins.panelClose(r.panelSession)
        return
      }
      if (r.ok) {
        sessionRef.current = r.panelSession
        setState({ k: 'ready', session: r.panelSession, url: r.url, canvasAllow: r.canvasAllow, title: r.title, version: r.version })
        // 老节点（建的时候还没命名）补上面板标题，别顶着「插件面板」四个字
        // 没名字、或还顶着组件的默认名「插件面板」（节点创建时可能已被填上默认名）都补
        if (!nodeName || nodeName === getCanvasComponent('plugin-panel')?.name) renameNode(ctx.frameId, ctx.nodeId, r.title)
      } else setState({ k: 'error', msg: r.error })
    })
    return () => {
      live = false
      const s = sessionRef.current
      sessionRef.current = null
      if (s) void window.api.plugins.panelClose(s)
    }
    // ctx 里的 nodeId/frameId 变了（节点被挪去别的 Frame）不重开，走下面的 host-context-changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, panelId, reloadKey])

  // 面板 → 宿主
  useEffect(() => {
    if (state.k !== 'ready') return
    const onMsg = async (e: MessageEvent): Promise<void> => {
      const f = iframeRef.current
      if (!f || e.source !== f.contentWindow) return
      const post = (m: unknown): void => f.contentWindow?.postMessage(m, '*')
      const r = routeViewMessage(e.data, initializedRef.current)
      if (r.kind === 'drop') {
        if (r.id !== undefined) post(methodNotFound(r.id, String((e.data as { method?: unknown })?.method ?? '')))
        return
      }
      if (r.kind === 'notification') {
        if (r.method === 'ui/notifications/initialized') initializedRef.current = true
        if (r.method === 'ui/notifications/size-changed') {
          const p = (r.params ?? {}) as { width?: unknown; height?: unknown }
          const size = clampPanelSize({ w: p.width, h: p.height }, nodeSize)
          resizeNode(ctx.frameId, ctx.nodeId, size.w, size.h)
        }
        return
      }
      switch (r.method) {
        case 'ui/initialize': {
          post(resultResponse(r.id, initializeResult(panelCtx, themeNow(), state.canvasAllow, state.version)))
          // 按规范面板随后会发 notifications/initialized；有的实现不发，这里就当握手完成
          initializedRef.current = true
          return
        }
        case 'ping':
          post(resultResponse(r.id, {}))
          return
        case 'eas/panel.resize': {
          const size = clampPanelSize((r.params ?? {}) as { w?: unknown; h?: unknown }, nodeSize)
          resizeNode(ctx.frameId, ctx.nodeId, size.w, size.h)
          post(resultResponse(r.id, size))
          return
        }
        default: {
          const res = await window.api.plugins.panelRpc(state.session, r.method, r.params)
          post(res.ok ? resultResponse(r.id, res.result) : errorResponse(r.id, res.code, res.error))
        }
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, nodeW, nodeH, ctx.frameId, ctx.nodeId])

  // 宿主 → 面板
  useEffect(() => {
    if (state.k !== 'ready') return
    return window.api.plugins.onPanelNotify((p) => {
      if (p.panelSession !== state.session) return
      if (p.method === 'ui/resource-teardown') {
        setState({ k: 'error', msg: '插件进程退出了' })
        return
      }
      iframeRef.current?.contentWindow?.postMessage({ jsonrpc: '2.0', method: p.method, params: p.params }, '*')
    })
  }, [state])

  // 节点被挪到别的 Frame / 主题变了 → host-context-changed
  useEffect(() => {
    if (state.k !== 'ready' || !initializedRef.current) return
    iframeRef.current?.contentWindow?.postMessage(
      { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: themeNow(), _meta: { eas: { context: panelCtx } } } },
      '*'
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.frameId, ctx.cwd, ctx.projectId])

  if (state.k === 'loading') return <div className="plg-state">正在起插件…</div>
  if (state.k === 'error')
    return (
      <div className="plg-state plg-err">
        <div>{state.msg}</div>
        {pluginId && (
          <button type="button" className="plg-retry" onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </button>
        )}
      </div>
    )
  return (
    <iframe
      key={state.session}
      ref={iframeRef}
      className="plg-frame"
      title={state.title}
      src={state.url}
      // **只有 allow-scripts。** 不给 allow-same-origin（否则它能读父页）、不给 popups /
      // top-navigation / forms。这是设计稿第五节的第 1 条验收项。
      sandbox="allow-scripts"
    />
  )
}
