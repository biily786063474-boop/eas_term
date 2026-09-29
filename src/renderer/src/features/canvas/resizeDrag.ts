// 画布拖拽手势的共用起止逻辑（缩放拖动起家，2026-09-29 推广到所有画布拖拽）。
//
// 事故：缩放时指针滑过节点里的 iframe / webview（插件面板、HTML 预览、浏览器节点），
// 宿主 document 就收不到 mousemove / mouseup 了——松手后节点仍跟着鼠标缩放，直到再点一下画布。
// 2026-09-29 插件面板 iframe 改成始终接收指针后（用户改规则：首击直达），框选 / 拖节点 / 平移
// 划过插件面板同样中招（真机：框选进了面板就停，松手后选框还跟着鼠标）。
// 做法：拖动期间给 body 挂类（缩放 `canvas-resizing`，其余 `canvas-dragging`；canvas.css 里让
// iframe/webview 不接鼠标），并在 mouseup / window blur / Escape / buttons===0 的 mousemove /
// 组件卸载（调用方拿返回的 stop）时统一收尾。已有先例：分屏分隔条的 body.dragging-col。

export const RESIZING_CLASS = 'canvas-resizing'
export const DRAGGING_CLASS = 'canvas-dragging'

type Listener = (ev: never) => void
type ClassList = { add(c: string): void; remove(c: string): void }
export interface ResizeDragEnv {
  doc: {
    body: { classList: ClassList }
    addEventListener(t: string, l: Listener): void
    removeEventListener(t: string, l: Listener): void
  }
  win: {
    addEventListener(t: string, l: Listener): void
    removeEventListener(t: string, l: Listener): void
  }
}

export interface CanvasDragOptions {
  env?: ResizeDragEnv
  /** 拖动期间挂在 body 上的类，默认 `canvas-dragging` */
  bodyClass?: string
  /** 失焦策略：不传 = window blur 当场收尾；传 `attachBlurGuard` = 过滤灵动岛那类 blur→focus 抖动。
   *  参数是收尾函数，返回拆除函数。 */
  blurGuard?: (end: () => void) => () => void
}

const defaultEnv = (): ResizeDragEnv => ({ doc: document as never, win: window as never })

// 同一个类可能被两个重叠的手势同时持有（比如 beginPan 先收尾旧的再开新的），按引用计数摘。
const holds = new WeakMap<ClassList, Map<string, number>>()
function hold(cl: ClassList, c: string): void {
  const m = holds.get(cl) ?? new Map<string, number>()
  holds.set(cl, m)
  m.set(c, (m.get(c) ?? 0) + 1)
  cl.add(c)
}
function release(cl: ClassList, c: string): void {
  const m = holds.get(cl)
  const n = (m?.get(c) ?? 1) - 1
  if (n > 0) { m!.set(c, n); return }
  m?.delete(c)
  cl.remove(c)
}

/** 开始一次画布拖拽。onMove 收到每次 mousemove；onEnd 在任何收尾路径上恰好调用一次：
 *  真松手时带那次 mouseup 事件（落点判定用），失焦 / Escape / 丢了 mouseup / stop() 时不带。
 *  返回 stop()，供组件卸载时强制收尾。 */
export function startCanvasDrag(
  onMove: (ev: MouseEvent) => void,
  onEnd: (up?: MouseEvent) => void,
  opts: CanvasDragOptions = {}
): () => void {
  let ended = false
  const { doc, win } = opts.env ?? defaultEnv()
  const cls = opts.bodyClass ?? DRAGGING_CLASS
  const move = (ev: MouseEvent): void => {
    if (ended) return
    // mouseup 丢了（落在 iframe / 窗口外）：不再跟随鼠标
    if (ev.buttons === 0) return finish()
    onMove(ev)
  }
  const key = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') finish()
  }
  const up = (ev: MouseEvent): void => finish(ev)
  const blur = (): void => finish()
  let detachBlur = (): void => {}
  function finish(ev?: MouseEvent): void {
    if (ended) return
    ended = true
    doc.removeEventListener('mousemove', move as Listener)
    doc.removeEventListener('mouseup', up as Listener)
    doc.removeEventListener('keydown', key as Listener)
    detachBlur()
    release(doc.body.classList, cls)
    onEnd(ev)
  }
  hold(doc.body.classList, cls)
  doc.addEventListener('mousemove', move as Listener)
  doc.addEventListener('mouseup', up as Listener)
  doc.addEventListener('keydown', key as Listener)
  if (opts.blurGuard) detachBlur = opts.blurGuard(() => finish())
  else {
    win.addEventListener('blur', blur as Listener)
    detachBlur = () => win.removeEventListener('blur', blur as Listener)
  }
  return () => finish()
}

/** 缩放拖动：`canvas-resizing` + 立即失焦收尾（原行为不变）。 */
export function startResizeDrag(
  onMove: (ev: MouseEvent) => void,
  onEnd: () => void,
  env: ResizeDragEnv = defaultEnv()
): () => void {
  return startCanvasDrag(onMove, () => onEnd(), { env, bodyClass: RESIZING_CLASS })
}
