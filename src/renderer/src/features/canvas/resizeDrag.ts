// 画布节点缩放拖动的共用起止逻辑。
//
// 事故：缩放时指针滑过节点里的 iframe / webview（插件面板、HTML 预览、浏览器节点），
// 宿主 document 就收不到 mousemove / mouseup 了——松手后节点仍跟着鼠标缩放，直到再点一下画布。
// 做法：拖动期间给 body 挂 `canvas-resizing`（canvas.css 里让 iframe/webview 不接鼠标），
// 并在 mouseup / window blur / Escape / buttons===0 的 mousemove / 组件卸载（调用方拿返回的 stop）时统一收尾。
// 已有先例：分屏分隔条的 body.dragging-col。

export const RESIZING_CLASS = 'canvas-resizing'

type Listener = (ev: never) => void
export interface ResizeDragEnv {
  doc: {
    body: { classList: { add(c: string): void; remove(c: string): void } }
    addEventListener(t: string, l: Listener): void
    removeEventListener(t: string, l: Listener): void
  }
  win: {
    addEventListener(t: string, l: Listener): void
    removeEventListener(t: string, l: Listener): void
  }
}

const defaultEnv = (): ResizeDragEnv => ({ doc: document as never, win: window as never })

/** 开始一次缩放拖动。onMove 收到每次 mousemove；onEnd 在任何收尾路径上恰好调用一次
 * （松手 / 失焦 / Escape / 丢了 mouseup）。返回 stop()，供组件卸载时强制收尾（同样会触发 onEnd）。 */
export function startResizeDrag(
  onMove: (ev: MouseEvent) => void,
  onEnd: () => void,
  env: ResizeDragEnv = defaultEnv()
): () => void {
  let ended = false
  const { doc, win } = env
  const move = (ev: MouseEvent): void => {
    if (ended) return
    // mouseup 丢了（落在 iframe / 窗口外）：不再跟随鼠标
    if (ev.buttons === 0) return end()
    onMove(ev)
  }
  const key = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') end()
  }
  function end(): void {
    if (ended) return
    ended = true
    doc.removeEventListener('mousemove', move as Listener)
    doc.removeEventListener('mouseup', end as Listener)
    doc.removeEventListener('keydown', key as Listener)
    win.removeEventListener('blur', end as Listener)
    doc.body.classList.remove(RESIZING_CLASS)
    onEnd()
  }
  doc.body.classList.add(RESIZING_CLASS)
  doc.addEventListener('mousemove', move as Listener)
  doc.addEventListener('mouseup', end as Listener)
  doc.addEventListener('keydown', key as Listener)
  win.addEventListener('blur', end as Listener)
  return end
}
