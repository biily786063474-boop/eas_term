import {PluginConfigurationControls} from '../canvas/PluginConfigurationControls'
import type {PluginInfo} from '../../../../shared/types'
import { hostActionAllowed, splitRequestOf } from '../../../../shared/panelHostActions'
import type {SecretsStatus} from '../../../../shared/types'
import {VaultGate} from '../workspace/VaultGate'
import { vaultStateForUse } from '../workspace/vaultCheck'
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
import { ReceiptDialog } from '../canvas/ReceiptDialog'
import type { ReceiptContent } from '../canvas/receiptReport'
import { timelineReceipt } from './timelineReceipt'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useT } from '../../i18n.ts'
import { getCanvasComponent, type CanvasComponentCtx } from '../canvas/components/registry'
import {
  clampPanelSize,
  errorResponse,
  initializeResult,
  methodNotFound,
  notification,
  resultResponse,
  routeViewMessage,
  type PanelCtx
} from './appsProtocol.ts'
import { JSONRPC_INVALID_PARAMS } from '../../../../shared/pluginProtocol.ts'
import {
  uiMessageChip,
  uiMessageAllowed,
  frameInjectTargets,
  NO_TARGET_ERROR,
  PICK_BUSY_ERROR,
  PICK_CANCELLED_ERROR,
  AGENT_NOT_READY_ERROR,
  TERMINAL_EXITED_ERROR,
  terminalSafeText,
  terminalPastePlan,
  focusInjectTarget,
  type FocusDeps,
  type InjectTarget
} from './uiMessage.ts'
import { collectLeaves } from '../../layout'
import { CanvasContextMenu } from '../../ui/CanvasContextMenu'
import { bracketedPasteOf } from '../terminal/pasteModes.ts'
import { focusInputOf } from '../../store/inputFocusTargets.ts'
import {
  canvasPanStartAllowed,
  canvasSelectDecision,
  canvasWheelAllowed,
  iframePointToHost,
  mergePanelWheel,
  panPointFromScreen,
  parsePanelPan,
  parsePanelWheel,
  type PanelPan,
  type PanelWheel
} from './panelPointerBridge.ts'
import { attachHostPointerTracker, hostPointerGate, releaseHostPointerLatch } from './hostPointerTracker.ts'

// ui/message 注入成功后「聚焦过去」的三步，全部复用现成能力（同 runtimeLocateActions.locateService）：
// 选中 + focusCanvasNode（MCP canvas_focus_node 背后那个，同步改 viewport、无动画）；
// 键盘焦点等两帧——第一帧 React 提交新 viewport / 选中，第二帧再聚焦，不被画布那一轮渲染抢走。
const injectFocusDeps: FocusDeps = {
  reveal: (frameId, nodeId) => {
    const s = useStore.getState()
    if (!s.canvas.frames.find((f) => f.id === frameId)?.nodes.some((n) => n.id === nodeId)) return false
    if (s.viewMode !== 'canvas') s.setViewMode('canvas')
    useStore.getState().setCanvasSel(['n:' + frameId + ':' + nodeId])
    useStore.getState().focusCanvasNode(frameId, nodeId)
    return true
  },
  nextFrame: (cb) => { requestAnimationFrame(() => requestAnimationFrame(cb)) },
  focusInput: focusInputOf
}

type State =
  | { k: 'loading' }
  | { k: 'error'; msg: string }
  | { k: 'ready'; session: string; url: string; canvasAllow: string[]; title: string; version: string }

function themeNow(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function PluginPanel({ ctx, popup = false, onPopupResize, embedded, onUnavailable }: { ctx: CanvasComponentCtx; popup?: boolean; onPopupResize?: (w: number, h: number) => void; embedded?: { params: Record<string, unknown> }; onUnavailable?: () => void }): JSX.Element | null {
  const tr = useT()
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
  const [configuration,setConfiguration]=useState<PluginInfo|null>(null)
  const configurationPending=useRef(false)
  const [report,setReport]=useState<ReceiptContent|null>(null)
  const [vaultGate,setVaultGate]=useState<SecretsStatus|null>(null)
  const reportPending=useRef(false)
  const [reloadKey, setReloadKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const initializedRef = useRef(false)
  // ── 画布指针桥（2026-09-29 用户改规则：插件面板首击直达）────────────────────
  // iframe 始终接收指针。注入桥（src/main/panelHtml.ts）把 pointerdown 报成 canvas-select、
  // 未选中时把滚轮报成 canvas-wheel；这里负责「选中节点」和「把滚轮还给画布」。
  // 弹窗形态没有画布节点：永远按「已选中」告诉桥，让面板自己滚。
  const selKey = 'n:' + ctx.frameId + ':' + ctx.nodeId
  const nodeSelected = useStore((s) => s.canvasSel.includes(selKey))
  const selectedForBridge = popup || nodeSelected
  const selectedRef = useRef(selectedForBridge)
  selectedRef.current = selectedForBridge
  const lastSelectAt = useRef<number | null>(null)
  const pendingWheel = useRef<PanelWheel | null>(null)
  const wheelRaf = useRef<number | null>(null)
  const postSelected = (): void => {
    iframeRef.current?.contentWindow?.postMessage(notification('ui/notifications/canvas-selected', { selected: selectedRef.current }), '*')
  }
  /** 复用画布现有滚轮入口：在 iframe 元素上派发一个合成 wheel，冒泡进 CanvasStage 的 onWheel
   *  （平移 / 以光标为锚缩放 / 最大化时缩内容，全是那一份）。这里不写任何平移/缩放算法。 */
  const dispatchWheel = (w: PanelWheel): void => {
    const f = iframeRef.current
    if (!f || selectedRef.current) return
    const p = iframePointToHost({ x: w.clientX, y: w.clientY }, f.getBoundingClientRect(), { w: f.offsetWidth, h: f.offsetHeight })
    f.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: w.deltaX, deltaY: w.deltaY, deltaMode: w.deltaMode,
      ctrlKey: w.ctrlKey, metaKey: w.metaKey, clientX: p.x, clientY: p.y
    }))
  }
  const flushWheel = (): void => {
    wheelRaf.current = null
    const w = pendingWheel.current
    pendingWheel.current = null
    if (w) dispatchWheel(w)
  }
  // 选中状态变了 → 告诉桥（未选中才拦滚轮）
  useEffect(() => {
    if (state.k === 'ready') postSelected()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedForBridge, state])
  // 插件脚本能自己 post 这些消息（与桥同一个 contentWindow），所以宿主另要外部证据（修复轮 1）：
  // 选中要求 iframe 已拿到焦点（真实点击的 mousedown 默认动作）；消息万一先到，下一帧再看一次。
  const handleSelect = (recheck: boolean): void => {
    const f = iframeRef.current
    if (!f) return
    const d = canvasSelectDecision({ popup, selected: selectedRef.current, focused: document.activeElement === f, recheck, lastAt: lastSelectAt.current, now: performance.now() })
    if (d === 'recheck') { requestAnimationFrame(() => handleSelect(true)); return }
    if (d !== 'accept') return
    lastSelectAt.current = performance.now()
    // 与 CanvasStage 给节点的 onSelect 同一套动作（非累加选中 + 消掉手机角标）
    useStore.getState().toggleCanvasSel(selKey, false)
    useStore.getState().clearPhoneNode(ctx.nodeId)
  }
  // ── 中键平移（修复轮 1）：画布的中键平移挂在 document 捕获阶段（CanvasStage），iframe 吞掉了中键。
  // 桥报 pan-start → 在 iframe 元素上派发合成 mousedown(button 1)，由 CanvasStage 原有监听起 beginPan；
  // 之后桥报的 pan-move / pan-end 换成 document 上的合成 mousemove / mouseup，交给 beginPan 自己的监听。
  // beginPan 走共用画布拖拽，期间 body 挂 canvas-dragging 让 .plg-frame 不接指针：若 Chromium 因此把后续移动交回宿主，
  // 走的就是真实事件；若仍按按下时的帧路由给 iframe，走桥转发。两者不会同时发生。
  const panRef = useRef<{ hostX: number; hostY: number; screenX: number; screenY: number; stop: () => void } | null>(null)
  const endIframePan = (): void => {
    const p = panRef.current
    if (!p) return
    panRef.current = null
    p.stop()
    // beginPan 的 onUp 挂在 document 上；它已经收过尾（真实 mouseup）时这是空操作
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 1 }))
  }
  const startIframePan = (p: PanelPan): void => {
    const f = iframeRef.current
    if (!f) return
    endIframePan()
    const h = iframePointToHost({ x: p.clientX, y: p.clientY }, f.getBoundingClientRect(), { w: f.offsetWidth, h: f.offsetHeight })
    const onRealUp = (ev: MouseEvent): void => { if (ev.isTrusted) endIframePan() }
    const onBlur = (): void => endIframePan()
    document.addEventListener('mouseup', onRealUp, true)
    window.addEventListener('blur', onBlur)
    panRef.current = {
      hostX: h.x, hostY: h.y, screenX: p.screenX, screenY: p.screenY,
      stop: () => { document.removeEventListener('mouseup', onRealUp, true); window.removeEventListener('blur', onBlur) }
    }
    f.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, buttons: 4, clientX: h.x, clientY: h.y }))
  }
  const moveIframePan = (p: PanelPan): void => {
    const start = panRef.current
    if (!start) return
    if ((p.buttons & 4) === 0) { endIframePan(); return }
    const pt = panPointFromScreen(start, p)
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 4, clientX: pt.x, clientY: pt.y }))
  }
  // 「指针在这个面板里」（修复轮 3，取代 `:hover`：它在 OOPIF 里恒为假）：宿主最后一次看到的指针
  // 落在包住 iframe 的节点框（外扩 48px，修复轮 4 真机：快速甩入一次 move 跨 30–50px）内。指针在 iframe 里时父文档没有更新的 move，见 pointerInNode。
  // 修复轮 4：首次命中即给本面板上闩（createPointerLatch）—— 转发的滚轮会挪动节点，而记录点停在进场处，
  // 只比实时框几格后就漂出去了。闩在下一次真实宿主 move / 失焦 / 离开窗口 / 卸载 / 被选中时解开。
  const latchId = useRef({}).current
  const pointerInPanel = (f: HTMLIFrameElement): boolean =>
    hostPointerGate(latchId, (f.closest('.cfile-node') ?? f).getBoundingClientRect())
  useEffect(() => attachHostPointerTracker(), [])
  useEffect(() => () => releaseHostPointerLatch(latchId), [latchId])
  useEffect(() => {
    if (selectedForBridge) releaseHostPointerLatch(latchId)
  }, [selectedForBridge, latchId])
  useEffect(() => () => {
    if (wheelRaf.current !== null) cancelAnimationFrame(wheelRaf.current)
    endIframePan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const sessionRef = useRef<string | null>(null)
  // ui/message 有多个目标时弹的「注入到哪个？」菜单。state 管渲染，ref 给 onMsg 闭包读
  //（onMsg 的 effect 不随它重订阅）；resolve 只认自己那一份，点选后 onClose 再调一次是空操作。
  type Pick = { x: number; y: number; targets: InjectTarget[]; resolve: (t: InjectTarget | null) => void }
  const [pick, setPick] = useState<Pick | null>(null)
  const pickRef = useRef<Pick | null>(null)
  const pickTarget = (targets: InjectTarget[]): Promise<InjectTarget | null> =>
    new Promise((done) => {
      const b = iframeRef.current?.getBoundingClientRect()
      const p: Pick = {
        x: b ? b.left + b.width / 2 : window.innerWidth / 2,
        y: b ? b.top + b.height / 2 : window.innerHeight / 2,
        targets,
        resolve: (t) => {
          if (pickRef.current !== p) return
          pickRef.current = null
          setPick(null)
          done(t)
        }
      }
      pickRef.current = p
      setPick(p)
    })
  // 卸载时关菜单，挂起的请求回「已取消」
  useEffect(() => {
    return () => pickRef.current?.resolve(null)
  }, [])
  // 面板进程退出 / 重开时菜单会随 iframe 一起消失，挂起的请求也回「已取消」
  useEffect(() => {
    if (state.k !== 'ready' || configuration) pickRef.current?.resolve(null)
  }, [state, configuration])
  const panelCtx: PanelCtx = { nodeId: ctx.nodeId, frameId: ctx.frameId, projectId: ctx.projectId, cwd: ctx.cwd, ...(popup ? { surface: 'popup' } : {}), ...(embedded ? { params: embedded.params } : {}) }

  // 打开 / 关闭
  useEffect(() => {
    if (!pluginId) {
      setState({ k: 'error', msg: tr('pluginShell.noPlugin') })
      return
    }
    let live = true
    setReport(null)
    setVaultGate(null)
    initializedRef.current = false
    setState({ k: 'loading' })
    void window.api.plugins.panelOpen({ pluginId, panelId, ctx: (({ params: _params, ...rest }) => rest)(panelCtx), resumeStopped: reloadKey > 0 }).then((r) => {
      if (!live) {
        if (r.ok) void window.api.plugins.panelClose(r.panelSession)
        return
      }
      if (r.ok) {
        sessionRef.current = r.panelSession
        setState({ k: 'ready', session: r.panelSession, url: r.url, canvasAllow: r.canvasAllow, title: r.title, version: r.version })
        // 老节点（建的时候还没命名）补上面板标题，别顶着「插件面板」四个字
        // 没名字、或还顶着组件的默认名「插件面板」（节点创建时可能已被填上默认名）都补
        if (!popup && !embedded && (!nodeName || nodeName === getCanvasComponent('plugin-panel')?.name)) renameNode(ctx.frameId, ctx.nodeId, r.title)
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
      const msg = e.data as { jsonrpc?: unknown; method?: unknown; params?: unknown } | null
      if (!popup && msg?.jsonrpc === '2.0' && msg.method === 'ui/notifications/canvas-select') {
        handleSelect(false) // 焦点闸门 + 100ms 去抖，见 handleSelect
        return
      }
      if (msg?.jsonrpc === '2.0' && msg.method === 'ui/notifications/canvas-pan-start') {
        const p = parsePanelPan(msg.params)
        if (p && canvasPanStartAllowed({ popup, pointerIn: () => pointerInPanel(f) })) startIframePan(p)
        return
      }
      if (msg?.jsonrpc === '2.0' && msg.method === 'ui/notifications/canvas-pan-move') {
        const p = parsePanelPan(msg.params)
        if (p) moveIframePan(p)
        return
      }
      if (msg?.jsonrpc === '2.0' && msg.method === 'ui/notifications/canvas-pan-end') {
        endIframePan()
        return
      }
      if (msg?.jsonrpc === '2.0' && msg.method === 'ui/notifications/canvas-wheel') {
        // 已选中（或弹窗）时桥不该发；发了也不理。指针不在本面板里 = 不是用户在滚（插件伪造），丢弃。
        // 每帧最多派发一次，同类滚轮合并 delta
        if (!canvasWheelAllowed({ popup, selected: selectedRef.current, pointerIn: () => pointerInPanel(f) })) return
        const w = parsePanelWheel(msg.params)
        if (!w) return
        const m = mergePanelWheel(pendingWheel.current, w)
        if (m.flush) dispatchWheel(m.flush)
        pendingWheel.current = m.pending
        if (wheelRaf.current === null) wheelRaf.current = requestAnimationFrame(flushWheel)
        return
      }
      if (msg?.jsonrpc === '2.0' && msg.method === 'ui/notifications/canvas-select') return
      const modifier = e.data as { jsonrpc?: unknown; method?: unknown; params?: { pressed?: unknown } } | null
      if (!popup && modifier?.jsonrpc === '2.0' && modifier.method === 'ui/notifications/canvas-zoom-modifier') {
        if (typeof modifier.params?.pressed === 'boolean') f.classList.toggle('plg-zoom-modifier', modifier.params.pressed)
        return
      }
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
          if (popup) onPopupResize?.(size.w, size.h)
          else resizeNode(ctx.frameId, ctx.nodeId, size.w, size.h)
        }
        return
      }
      switch (r.method) {
        case 'ui/initialize': {
          // __easVerifyNoSplit：仅验收（preload 要求 EAS_VERIFY=1 且 EAS_SPLIT_DISABLED=1），模拟不声明分屏的旧宿主
          const noSplit = (window as unknown as { __easVerifyNoSplit?: boolean }).__easVerifyNoSplit === true
          post(resultResponse(r.id, initializeResult(panelCtx, themeNow(), state.canvasAllow, state.version, { split: !noSplit })))
          // 按规范面板随后会发 notifications/initialized；有的实现不发，这里就当握手完成
          initializedRef.current = true
          postSelected()
          return
        }
        case 'panel/configuration': {
          if(configurationPending.current){post(errorResponse(r.id,-32602,'设置已在打开'));return}
          configurationPending.current=true
          try{
            const result=await window.api.plugins.panelRpc(state.session,r.method,{})
            if(!result.ok)throw Error(result.error)
            const plugin=(await window.api.plugins.list()).find(item=>item.id===pluginId)
            if(!plugin?.config)throw Error('插件已移除或配置已改变')
            setConfiguration(plugin)
            post(resultResponse(r.id,{opened:true}))
          }catch(error){post(errorResponse(r.id,-32603,String(error)))}
          finally{configurationPending.current=false}
          return
        }
        case 'panel/timeline-report': {
          if(pluginId!=='eas:timeline'||reportPending.current||report){post(errorResponse(r.id,-32602,'无法重复打开成果周报'));return}
          reportPending.current=true
          try {
            const res=await window.api.plugins.panelRpc(state.session,r.method,r.params)
            if(sessionRef.current!==state.session)return
            if(!res.ok)throw new Error(res.error)
            setReport(timelineReceipt(res.result))
            post(resultResponse(r.id,{opened:true}))
          }catch(error){post(errorResponse(r.id,-32603,String(error)))}
          finally{reportPending.current=false}
          return
        }
        case 'panel/clipboard.write':
        case 'panel/reveal': {
          // 2026-09-29 发布台：一键复制 / 在访达中显示。焦点与点击状态必须在 await 之前取（量的是请求到达那一刻）
          const focused = document.activeElement === f
          const activated = navigator.userActivation?.isActive === true
          let remote: boolean | null = null
          try {
            const plugin = (await window.api.plugins.list()).find((item) => item.id === pluginId)
            remote = plugin ? !!plugin.remote : null
          } catch { remote = null }
          const gate = hostActionAllowed({ remote, focused, activated })
          if (!gate.ok) { post(errorResponse(r.id, -32603, gate.error)); return }
          const res = await window.api.plugins.panelRpc(state.session, r.method, r.params)
          post(res.ok ? resultResponse(r.id, res.result) : errorResponse(r.id, res.code, res.error))
          return
        }
        case 'panel/split.open': {
          // 2026-10-02 发布台分屏：同 clipboard.write 的闸门（本地插件 + 焦点 + 真实点击），再要清单 permissions.split
          const focused = document.activeElement === f
          const activated = navigator.userActivation?.isActive === true
          let plugin: PluginInfo | undefined
          try { plugin = (await window.api.plugins.list()).find((item) => item.id === pluginId) } catch { plugin = undefined }
          const gate = hostActionAllowed({ remote: plugin ? !!plugin.remote : null, focused, activated })
          if (!gate.ok) { post(errorResponse(r.id, -32603, gate.error)); return }
          if (!plugin || plugin.permissions?.split !== true || popup || embedded) { post(errorResponse(r.id, -32603, '这个插件没有分屏权限')); return }
          const req = splitRequestOf(r.params, (plugin.panels ?? []).map((x) => x.id))
          if (!req.ok) { post(errorResponse(r.id, -32602, req.error)); return }
          const st = useStore.getState()
          const res = st.openSplit({ pluginId: plugin.id, parentFrameId: ctx.frameId, ...req.value })
          if (!res) { post(errorResponse(r.id, -32603, '面板所在的 Frame 不在了')); return }
          if (!res.opened.length && !res.replaced.length && res.reused.length) {
            const frame = useStore.getState().canvas.frames.find((x) => x.id === res.frameId)
            const node = frame?.nodes.find((n) => n.pane?.kind === 'web' && n.pane.companion?.key === res.reused[0])
            if (frame && node) { st.focusCanvasNode(frame.id, node.id, { fit: true }); st.flashNode(node.id) }
          }
          post(resultResponse(r.id, { opened: res.opened, reused: res.reused, replaced: res.replaced }))
          return
        }
        case 'ping':
          post(resultResponse(r.id, {}))
          return
        case 'eas/panel.resize': {
          // 嵌入网页节点头条：高度由宿主固定 44，面板不得改节点尺寸
          if (embedded) { post(resultResponse(r.id, { w: 0, h: 44 })); return }
          const size = clampPanelSize((r.params ?? {}) as { w?: unknown; h?: unknown }, nodeSize)
          if (popup) onPopupResize?.(size.w, size.h)
          else resizeNode(ctx.frameId, ctx.nodeId, size.w, size.h)
          post(resultResponse(r.id, size))
          return
        }
        case 'ui/message': {
          // 面板要往本 Frame 里的 AI 对话 / 终端塞一段话（Task 7：按 Frame 找目标，不再取「最后聚焦的对话框」）。
          // 就地处理不绕主进程——chip 入口只在渲染层；弹窗面板也允许，它不碰画布节点。
          // 闸门（最终审查 I-1）：只放行本地插件 + 请求到达时焦点就在本面板 iframe 里。
          // 焦点必须在 await 之前取：量的是「请求到达那一刻」，不是查完列表之后。
          const focused = document.activeElement === f
          let remote: boolean | null = null
          try {
            const plugin = (await window.api.plugins.list()).find((item) => item.id === pluginId)
            remote = plugin ? !!plugin.remote : null
          } catch { remote = null }
          const gate = uiMessageAllowed({ remote, focused })
          if (!gate.ok) { post(errorResponse(r.id, -32603, gate.error)); return }
          const res = uiMessageChip(r.params, { id: pluginId ?? '', title: state.title })
          if (!res.ok) { post(errorResponse(r.id, JSONRPC_INVALID_PARAMS, res.error)); return }
          if (pickRef.current) { post(errorResponse(r.id, -32603, PICK_BUSY_ERROR)); return }
          const leavesNow = (): ReturnType<typeof collectLeaves> => useStore.getState().tabs.flatMap((t) => collectLeaves(t.root))
          const frame = useStore.getState().canvas.frames.find((x) => x.id === ctx.frameId)
          const targets = frame ? frameInjectTargets(frame, leavesNow()) : []
          if (!targets.length) { post(errorResponse(r.id, -32603, NO_TARGET_ERROR)); return }
          const target = targets.length === 1 ? targets[0] : await pickTarget(targets)
          if (!target) { post(errorResponse(r.id, -32603, PICK_CANCELLED_ERROR)); return }
          if (target.kind === 'agent') {
            // 输入框挂载时按 leafId 登记（AgentChatView 空态 / ChatToolbar 对话态），没挂载就没有
            const addTo = useStore.getState().chipTargets[target.leafId]
            if (!addTo) { post(errorResponse(r.id, -32603, AGENT_NOT_READY_ERROR)); return }
            addTo(res.chip)
            post(resultResponse(r.id, { target: { kind: 'agent', name: target.name } }))
            focusInjectTarget(ctx.frameId, target, injectFocusDeps)
            return
          }
          // 终端：选菜单期间可能关掉了 —— 照 DictView 现查 ptyId 是否还在某个面板里
          //（pty 死后 write 是静默 no-op，会假装成功）。
          const ptyId = target.ptyId
          const alive = !!ptyId && leavesNow().some((l) => l.pane.kind === 'terminal' && l.pane.ptyId === ptyId)
          if (!ptyId || !alive) { post(errorResponse(r.id, -32603, TERMINAL_EXITED_ERROR)); return }
          // 第三方文本：先去掉 ESC / 控制符（否则夹一个 ESC[201~ 就能提前结束粘贴、后面的行被执行），
          // 再按前台程序此刻的 bracketed paste 模式决定：开着 → 包住全文；没开 → 拒（换行就是回车）；
          // 读不到（终端没挂载）→ 换行压成空格。**绝不追加回车** —— 发不发由用户看过后自己按。
          const plan = terminalPastePlan(terminalSafeText(res.chip.text), bracketedPasteOf(ptyId))
          if (!plan.ok) { post(errorResponse(r.id, -32603, plan.error)); return }
          window.api.pty.write(ptyId, plan.data)
          post(resultResponse(r.id, { target: { kind: 'terminal', name: target.name } }))
          focusInjectTarget(ctx.frameId, target, injectFocusDeps)
          return
        }
        default: {
          if(pluginId==='eas:jev' && r.method==='panel/grant' && (r.params as {action?:unknown}|null)?.action==='connect'){
            try{
              // 真检查而不是展示态：信任设备首用验证前 status() 说「已解锁」，照它放行会白跑一次（见 vaultCheck.ts）
              const vault=await vaultStateForUse(window.api.secrets)
              if(sessionRef.current!==state.session)return
              if(vault.needsUnlock){setVaultGate(vault.status);post(errorResponse(r.id,-32603,'请先解锁密钥柜，然后再次点击验证连接'));return}
            }catch(error){post(errorResponse(r.id,-32603,String(error)));return}
          }
          const res = await window.api.plugins.panelRpc(state.session, r.method, r.params)
          post(res.ok ? resultResponse(r.id, res.result) : errorResponse(r.id, res.code, res.error))
        }
      }
    }
    window.addEventListener('message', onMsg)
    return () => { iframeRef.current?.classList.remove('plg-zoom-modifier'); window.removeEventListener('message', onMsg) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, nodeW, nodeH, ctx.frameId, ctx.nodeId, report])

  // 宿主 → 面板
  useEffect(() => {
    if (state.k !== 'ready') return
    return window.api.plugins.onPanelNotify((p) => {
      if (p.panelSession !== state.session) return
      if (p.method === 'ui/resource-teardown') {
        setReport(null)
        setState({ k: 'error', msg: tr('pluginShell.exited') })
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

  // 主题变了 → host-context-changed。上面那个只在节点换 Frame / 目录时发，主题切换从来没送到已开的面板：
  // 所有插件面板都停在打开那一刻的主题，切到亮色后还是深色的字和底（2026-10-02 发布台改版时实测）。
  // 盯 <html data-theme> 而不是 store：applyTheme 和「跟随系统」最后都落在这个属性上。
  useEffect(() => {
    if (state.k !== 'ready') return
    let last = themeNow()
    const mo = new MutationObserver(() => {
      const now = themeNow()
      if (now === last || !initializedRef.current) return
      last = now
      iframeRef.current?.contentWindow?.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: now } }, '*')
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [state])

  // 嵌入头条：插件不可用（禁用/卸载/崩溃）时通知宿主收起头条，面板自己不画任何错误
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable
  useEffect(() => {
    if (embedded && state.k === 'error') onUnavailableRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.k, !!embedded])

  if(configuration)return <PluginConfigurationControls plugin={configuration} initialOpen onClose={()=>{setConfiguration(null);setReloadKey(k=>k+1)}}/>
  if (state.k === 'loading') return embedded ? null : <div className="plg-state">{tr('pluginShell.starting')}</div>
  if (state.k === 'error') {
    if (embedded) return null
    return (
      <div className="plg-state plg-err">
        <div>{state.msg}</div>
        {pluginId && (
          <button type="button" className="plg-retry" onClick={() => setReloadKey((k) => k + 1)}>
            {tr('pluginShell.retry')}
          </button>
        )}
      </div>
    )
  }
  return (
    <>
    {vaultGate&&<div className="plg-vault-gate" role="dialog" aria-modal="true" aria-label={tr('pluginShell.vaultGateLabel')}><div className="plg-vault-gate-inner"><p>{tr('pluginShell.vaultGateText')}</p><VaultGate status={vaultGate} onUnlocked={()=>setVaultGate(null)}/><button type="button" onClick={()=>setVaultGate(null)}>{tr('pluginShell.vaultGateCancel')}</button></div></div>}
    {pick && (
      <CanvasContextMenu
        x={pick.x}
        y={pick.y}
        header={{ placeholder: tr('pluginShell.pickPlaceholder') }}
        items={pick.targets.map((t) => ({ label: t.name, hint: t.kind === 'agent' ? tr('pluginShell.agentKind') : tr('pluginShell.terminalKind'), onClick: () => pick.resolve(t) }))}
        onClose={() => pick.resolve(null)}
      />
    )}
    {report&&<ReceiptDialog title={report.title} initialContent={report} privacy={tr('pluginShell.receiptPrivacy')} onClose={()=>setReport(null)}/>}
    <iframe
      key={state.session}
      ref={iframeRef}
      className={`plg-frame${embedded ? ' plg-embedded' : ''}`}
      title={state.title}
      src={state.url}
      // 文档刚载入时桥默认「未选中」；已选中的节点重载后要立刻补发一次
      onLoad={postSelected}
      // **只有 allow-scripts。** 不给 allow-same-origin（否则它能读父页）、不给 popups /
      // top-navigation / forms。这是设计稿第五节的第 1 条验收项。
      sandbox="allow-scripts"
    />
    </>
  )
}
