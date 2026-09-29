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
