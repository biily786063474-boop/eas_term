// 插件面板注入桥（src/main/panelHtml.ts）发回宿主的指针消息 —— 宿主侧的**纯函数**。零 import，进 node --test。
//
// 2026-09-29 用户改规则：iframe 始终接收指针（首击直达面板内容），未选中时由注入桥拦下滚轮、
// 转发 `ui/notifications/canvas-wheel` 给宿主驱动画布。这里负责：
//   · 把 iframe 内的 clientX/Y 换算成宿主坐标（画布缩放通过 CSS transform 作用在 iframe 上）
//   · 校验并夹住插件发来的数字（消息是插件脚本也能伪造的）
//   · 限流：wheel 每帧合并一次；select 100ms 去抖（前沿放行）

export const CANVAS_SELECT_DEBOUNCE_MS = 100
/** 单条 / 单帧合并后的 delta 上限（px 或行/页原值）。真实触控板一帧远到不了；插件刷消息推不远。 */
export const WHEEL_DELTA_MAX = 1000

export type PanelWheel = {
  deltaX: number
  deltaY: number
  deltaMode: 0 | 1 | 2
  ctrlKey: boolean
  metaKey: boolean
  clientX: number
  clientY: number
}

const clampDelta = (v: number): number => Math.max(-WHEEL_DELTA_MAX, Math.min(WHEEL_DELTA_MAX, v))
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * iframe 视口坐标 → 宿主视口坐标。`rect` 是 iframe 的 getBoundingClientRect()（已含画布缩放），
 * `size` 是 iframe 自身的布局尺寸（offsetWidth/Height，未经 transform）。两者之比就是画布缩放。
 */
export function iframePointToHost(
  pt: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  size: { w: number; h: number }
): { x: number; y: number } {
  const sx = size.w > 0 && rect.width > 0 ? rect.width / size.w : 1
  const sy = size.h > 0 && rect.height > 0 ? rect.height / size.h : 1
  return { x: rect.left + pt.x * sx, y: rect.top + pt.y * sy }
}

/** 校验 canvas-wheel 的 params；不合法返回 null（整条丢弃）。 */
export function parsePanelWheel(params: unknown): PanelWheel | null {
  if (!params || typeof params !== 'object') return null
  const p = params as Record<string, unknown>
  if (!num(p.deltaX) || !num(p.deltaY) || !num(p.clientX) || !num(p.clientY)) return null
  if (p.deltaMode !== 0 && p.deltaMode !== 1 && p.deltaMode !== 2) return null
  return {
    deltaX: clampDelta(p.deltaX),
    deltaY: clampDelta(p.deltaY),
    deltaMode: p.deltaMode,
    ctrlKey: p.ctrlKey === true,
    metaKey: p.metaKey === true,
    clientX: p.clientX,
    clientY: p.clientY
  }
}

/**
 * 把新到的一条并进本帧待派发的那条。缩放/平移（ctrlKey）或 deltaMode 不同的不合并：
 * 返回 `flush` = 旧的那条，宿主应立即派发它，再以新的一条开新批次。
 */
export function mergePanelWheel(pending: PanelWheel | null, next: PanelWheel): { pending: PanelWheel; flush: PanelWheel | null } {
  if (!pending) return { pending: next, flush: null }
  if (pending.ctrlKey !== next.ctrlKey || pending.deltaMode !== next.deltaMode) return { pending: next, flush: pending }
  return {
    pending: {
      ...next,
      deltaX: clampDelta(pending.deltaX + next.deltaX),
      deltaY: clampDelta(pending.deltaY + next.deltaY),
      metaKey: pending.metaKey || next.metaKey
    },
    flush: null
  }
}

/** select 去抖：前沿放行（第一下立刻选中），`ms` 内的重复丢弃。 */
export function acceptPanelSelect(lastAt: number | null, now: number, ms = CANVAS_SELECT_DEBOUNCE_MS): boolean {
  return lastAt === null || now - lastAt >= ms
}

// ── 宿主侧闸门（修复轮 1，2026-09-29 评审）───────────────────────────────────
// 插件脚本与注入桥同在一个 contentWindow，`e.source` 分不出是谁 post 的；桥里的 isTrusted
// 只挡得住插件 dispatch 的合成 DOM 事件，挡不住插件直接 postMessage。所以宿主再要一个
// 「真有人在操作这个 iframe」的外部证据：点击 → iframe 已拿到焦点；滚轮 / 中键 → 指针在这个面板里
// （修复轮 3 起用 pointerInNode，不用 `:hover` —— 后者在 OOPIF 里恒为假）。

/**
 * canvas-select 的处理决定。真实点击会让 iframe 成为 `document.activeElement`（mousedown 默认动作），
 * 消息通常在那之后才到；万一先到，下一帧再看一次（`recheck`），仍不在就丢弃。
 */
export function canvasSelectDecision(o: {
  popup: boolean
  selected: boolean
  focused: boolean
  recheck: boolean
  lastAt: number | null
  now: number
}): 'accept' | 'recheck' | 'drop' {
  if (o.popup || o.selected || !acceptPanelSelect(o.lastAt, o.now)) return 'drop'
  if (o.focused) return 'accept'
  return o.recheck ? 'drop' : 'recheck'
}

/**
 * canvas-wheel 只在未选中、非弹窗、且指针确实在本面板里（`pointerIn`，见 PointerLatch）时驱动画布。
 * `pointerIn` 是惰性的：前两条不过就不去问闸门 —— 问闸门本身可能「上闩」（修复轮 4），不该被注定丢弃的消息触发。
 */
export function canvasWheelAllowed(o: { popup: boolean; selected: boolean; pointerIn: () => boolean }): boolean {
  return !o.popup && !o.selected && o.pointerIn()
}

/** 中键平移：画布约定「在模块上按中键也能拖」，不看选中；只要求非弹窗且指针在本面板里（惰性，同上）。 */
export function canvasPanStartAllowed(o: { popup: boolean; pointerIn: () => boolean }): boolean {
  return !o.popup && o.pointerIn()
}

/**
 * 节点框外扩量。真机探针：进 iframe 前父文档最后一次 mousemove 落在节点边缘（target 是 .cframe / .cfile-head）。
 * 修复轮 4 真机补充：快速甩进面板时一次 move 跨 30–50px，最后一点可落在框外 >8px（修复轮 3 的 8px 下每格都丢）。
 * 所以取 48px。代价：指针停在未选中面板 48px 以内时，插件伪造的 canvas-wheel 能过闸（只能平移 / 缩放画布）。
 */
export const POINTER_NODE_INFLATE = 48

/**
 * 「指针进了这个面板、还没出来」（修复轮 3，取代 `:hover`）。
 *
 * 真机探针（task-6-report.md「Hover-signal probe」）：指针进到插件 OOPIF 里之后，父文档收不到
 * pointerover/enter/out/leave，也收不到 mousemove，iframe 与 .cfile-body 都不带 `:hover`
 * （所以 `:hover` 闸门恒为假，未选中面板上的滚轮 / 中键全失效）。离开后父文档的 move 恢复。
 * 于是宿主 document 捕获阶段记下的**最后一个**指针位置，若落在节点框（外扩 inflate）内，
 * 就说明指针是从这里进去的、之后没回到父文档。`last` 为 null（失焦 / 指针离开窗口时清空）= 不算。
 */
export function pointerInNode(
  last: { clientX: number; clientY: number } | null,
  rect: { left: number; top: number; right: number; bottom: number } | null,
  inflate = POINTER_NODE_INFLATE
): boolean {
  if (!last || !rect) return false
  return (
    last.clientX >= rect.left - inflate &&
    last.clientX <= rect.right + inflate &&
    last.clientY >= rect.top - inflate &&
    last.clientY <= rect.bottom + inflate
  )
}

/**
 * 「进场闩」（修复轮 4，2026-09-29 评审）。只比对 `pointerInNode(last, 节点实时框)` 会漂：
 * 转发的滚轮平移 / 缩放了画布，节点在静止的指针下面移走，而 `last` 还停在进场那一点 ——
 * 几格之后它就落到框外，后面的滚轮全被丢掉。
 *
 * 所以第一次放行时给这个面板**上闩**：wheel / pan-start 到达、且宿主最后记录点落在该面板节点框
 * （外扩 POINTER_NODE_INFLATE = 48px）内 —— 即指针从这里进了面板、之后宿主一次 move 都没见过。上闩期间无论节点挪到哪都放行。
 * 解闩：下一次**真实**宿主 pointermove / mousemove（任何目标，合成事件不算）、window blur、
 * document mouseleave / pointerleave、面板卸载、面板被选中。别的面板不继承这把闩。
 * 纯状态机，零 DOM：宿主（hostPointerTracker.ts）把事件喂进来，PluginPanel 调 gate / release。
 */
export type PointerLatch = {
  /** 真实宿主指针移动：记录位置并解闩 */
  onHostMove(p: { clientX: number; clientY: number }): void
  /** 失焦 / 指针离开窗口：清记录点并解闩 */
  onLeave(): void
  /** 面板卸载或被选中：只解它自己的闩 */
  release(panelId: unknown): void
  /** 该面板的 wheel / pan-start 是否放行；首次命中时上闩 */
  gate(panelId: unknown, rect: { left: number; top: number; right: number; bottom: number } | null): boolean
  last(): { clientX: number; clientY: number } | null
  latched(): unknown
}

export function createPointerLatch(inflate = POINTER_NODE_INFLATE): PointerLatch {
  let last: { clientX: number; clientY: number } | null = null
  let holder: unknown = null
  return {
    onHostMove(p) {
      last = { clientX: p.clientX, clientY: p.clientY }
      holder = null
    },
    onLeave() {
      last = null
      holder = null
    },
    release(panelId) {
      if (holder === panelId) holder = null
    },
    gate(panelId, rect) {
      if (holder !== null) return holder === panelId // 指针只可能在一个面板里：别的面板不继承
      if (!pointerInNode(last, rect, inflate)) return false
      holder = panelId
      return true
    },
    last: () => last,
    latched: () => holder
  }
}

export type PanelPan = { clientX: number; clientY: number; screenX: number; screenY: number; buttons: number }

export function parsePanelPan(params: unknown): PanelPan | null {
  if (!params || typeof params !== 'object') return null
  const p = params as Record<string, unknown>
  if (!num(p.clientX) || !num(p.clientY) || !num(p.screenX) || !num(p.screenY)) return null
  return { clientX: p.clientX, clientY: p.clientY, screenX: p.screenX, screenY: p.screenY, buttons: num(p.buttons) ? p.buttons : 0 }
}

/**
 * 拖动中把 iframe 报来的指针位置换成宿主坐标。**用屏幕坐标差**：平移画布会挪动 iframe 本身，
 * 用 iframe 内 clientX 按当前 rect 换算会随平移漂移（自激）；屏幕坐标与画布无关。
 */
export function panPointFromScreen(
  start: { hostX: number; hostY: number; screenX: number; screenY: number },
  now: { screenX: number; screenY: number }
): { x: number; y: number } {
  return { x: start.hostX + (now.screenX - start.screenX), y: start.hostY + (now.screenY - start.screenY) }
}
