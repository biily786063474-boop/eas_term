// 辞典面板：从标题栏右上角那个按钮叫出来的浮动面板。
//
// ── 2026-08-31：悬浮球取消了 ────────────────────────────────────────
// 原来画布上常驻一个可拖动的小圆钮，点它弹面板。用户要求去掉 ——
// 它一直压在画布上，而辞典是「随手查一下」的工具，不该常驻占位。
//
// 现在：**标题栏点一下出现，点辞典以外任何地方收回**，
// 拖面板顶端那条可以挪位置，**下次出现在上次收回的地方**（存 localStorage）。
//
// ── 展开/收起的动画 ────────────────────────────────────────────────
// 从**面板自己的右上角**长出来 —— 那是标题栏那个触发按钮的方向。
// 原点放中心的话它看起来是凭空在半空中缩放，跟你点的按钮没有关系。
//
// 收起时**不能一置 false 就卸载**：那样 exit 动画根本没机会跑，
// 面板会「啪」地消失。先播完动画再卸载（见 close()）。
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { DictIcon, CloseIcon } from '../../ui/Icons'

const DictView = lazy(() => import('../dict/DictView').then((m) => ({ default: m.DictView })))

const POP_W = 360
const POP_H = 464
/** 展开/收起动画时长。**和 canvas.css 里 .cdict-pop 那条必须一致** ——
 *  对不上的话要么面板提前消失（JS 快）、要么留一帧空白（CSS 快） */
const ANIM_MS = 260
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/** 没存过位置时落在哪：右上角、标题栏底下。
 *  **每次调用现算** —— 窗口大小会变，算一次存起来的话换个屏幕就跑到界外了 */
const defaultPos = (): { x: number; y: number } => ({
  x: Math.max(8, window.innerWidth - POP_W - 20),
  y: 56
})

export function CanvasDictBubble(): JSX.Element | null {
  const open = useStore((s) => s.dictOpen)
  const setOpen = useStore((s) => s.setDictOpen)
  const savedPos = useStore((s) => s.dictPos)
  const setSavedPos = useStore((s) => s.setDictPos)

  /** 正在播收起动画。见文件头。 */
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  /** 拖动中的临时位置。**拖完才写 store** —— 每移动一像素写一次 localStorage
   *  既慢又会把整棵订阅了 dictPos 的树重渲染一遍 */
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)

  const close = (): void => {
    if (!open || closing) return
    setClosing(true)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, ANIM_MS)
  }

  // 点辞典以外的地方 → 收起。
  //
  // **挂 mousedown 不挂 click**：click 要等抬手，而拖画布时按下就该收了；
  // 而且画布上很多元素自己会 stopPropagation click。
  // **capture 阶段**：菜单、节点、输入框都会拦冒泡，挂冒泡的话点到它们收不起来 ——
  // 而那恰恰是「我在干别的事」最明确的信号。
  //
  // **标题栏那个触发按钮要放过**：不放过的话点它会先被这里收起、
  // 再被它自己切换成开，一次点击等于没反应。
  useEffect(() => {
    if (!open || closing) return
    const h = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (popRef.current?.contains(t)) return
      if (t.closest('[data-dict-toggle]')) return
      close()
    }
    window.addEventListener('mousedown', h, { capture: true })
    return () => window.removeEventListener('mousedown', h, { capture: true })
    // close 只读 open/closing，不进依赖免得每次重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing])

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    []
  )

  if (!open) return null

  // **每次渲染都按当前窗口夹一次**：存的位置是上次那个窗口大小下的，
  // 换了屏幕 / 缩了窗口之后直接用会把面板放到看不见的地方
  const base = drag ?? savedPos ?? defaultPos()
  const x = clamp(base.x, 8, Math.max(8, window.innerWidth - POP_W - 8))
  const y = clamp(base.y, 44, Math.max(44, window.innerHeight - POP_H - 8))

  const onHeadDown = (e: React.MouseEvent): void => {
    // 只认左键，且不从关闭按钮上起拖
    if (e.button !== 0 || (e.target as HTMLElement).closest('.cdict-pop-x')) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const ox = x
    const oy = y
    const onMove = (ev: MouseEvent): void => {
      setDrag({
        x: clamp(ox + ev.clientX - sx, 8, Math.max(8, window.innerWidth - POP_W - 8)),
        y: clamp(oy + ev.clientY - sy, 44, Math.max(44, window.innerHeight - POP_H - 8))
      })
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const nx = clamp(ox + ev.clientX - sx, 8, Math.max(8, window.innerWidth - POP_W - 8))
      const ny = clamp(oy + ev.clientY - sy, 44, Math.max(44, window.innerHeight - POP_H - 8))
      setDrag(null)
      // 真的挪了才写盘。原地点一下不该产生一次 localStorage 写入
      if (Math.hypot(nx - ox, ny - oy) >= 1) setSavedPos({ x: nx, y: ny })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={popRef}
      className={`cdict-pop${closing ? ' closing' : ''}`}
      style={{ left: x, top: y }}
      // 拖动中把过渡关掉：不关的话每一帧都在补间上一帧的位置，跟手感全没了
      data-dragging={drag ? '1' : undefined}
    >
      <div className="cdict-pop-head" onMouseDown={onHeadDown}>
        <DictIcon size={13} />
        <span>辞典</span>
        <button className="cdict-pop-x" data-tip="收起" onClick={close}>
          <CloseIcon size={13} />
        </button>
      </div>
      <div className="cdict-pop-body">
        <Suspense fallback={<div className="pane-placeholder">加载辞典…</div>}>
          <DictView embedded />
        </Suspense>
      </div>
    </div>
  )
}
