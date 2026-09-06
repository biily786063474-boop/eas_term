// 闪烁黑匣子的渲染层半边（主进程半边与动机见 main/diagLog.ts）。
//
// 只记三种事：① 画布世界层 / Frame / 活内容层的**直接子级**被移除或加入（= 某个 Frame /
// 节点 / 面板整段卸载重挂，React 层面的「闪」）② 单个任务 > 100ms（掉帧）③ 页面可见性变化。
// 观察器只看直接子级：`.canvas-world` 的子级是 Frame，`.cframe` 的子级是节点，`.pane-layer`
// 的子级是面板 —— 不进终端内部，xterm 刷屏的变动完全不经过它，空闲开销为零。

type Disconnect = () => void

function describe(el: Element): string {
  const cls = (el.className || el.tagName).toString().split(' ').slice(0, 2).join('.')
  const title = el.querySelector?.('.cfile-title, .cframe-title')?.textContent?.trim().slice(0, 24)
  const id = (el as HTMLElement).dataset?.nodeId || (el as HTMLElement).dataset?.fid || (el as HTMLElement).dataset?.leafId
  return [cls, id, title].filter(Boolean).join(' ')
}

function send(kind: string, what: string): void {
  try {
    window.api.diag.event({ kind, what })
  } catch {
    /* preload 没接上就算了 */
  }
}

/** 看一个容器的直接子级增删 */
export function watchChildren(el: Element, label: string): Disconnect {
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.removedNodes) if (n.nodeType === 1) send('unmount', `${label} ← ${describe(n as Element)}`)
      for (const n of m.addedNodes) if (n.nodeType === 1) send('mount', `${label} → ${describe(n as Element)}`)
    }
  })
  mo.observe(el, { childList: true })
  return () => mo.disconnect()
}

/** 画布：世界层的子级是 Frame；每个 Frame 再看它的子级（节点）。Frame 增删时跟着挂/摘。 */
export function watchCanvasWorld(world: Element): Disconnect {
  const perFrame = new Map<Element, Disconnect>()
  const hook = (fr: Element): void => {
    if (perFrame.has(fr)) return
    perFrame.set(fr, watchChildren(fr, `frame(${describe(fr)})`))
  }
  for (const fr of world.querySelectorAll(':scope > .cframe')) hook(fr)
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.removedNodes)
        if (n.nodeType === 1) {
          send('unmount', `world ← ${describe(n as Element)}`)
          perFrame.get(n as Element)?.()
          perFrame.delete(n as Element)
        }
      for (const n of m.addedNodes)
        if (n.nodeType === 1) {
          send('mount', `world → ${describe(n as Element)}`)
          if ((n as Element).matches('.cframe')) hook(n as Element)
        }
    }
  })
  mo.observe(world, { childList: true })
  return () => {
    mo.disconnect()
    for (const d of perFrame.values()) d()
    perFrame.clear()
  }
}

let globalStarted = false
/** 全局只起一次：长任务 + 可见性。 */
export function startGlobalRecorder(): void {
  if (globalStarted) return
  globalStarted = true
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration >= 100) send('longtask', `${Math.round(e.duration)}ms`)
    })
    po.observe({ entryTypes: ['longtask'] })
  } catch {
    /* 不支持 longtask 就没有这一路 */
  }
  document.addEventListener('visibilitychange', () => send('visibility', document.visibilityState))
}
