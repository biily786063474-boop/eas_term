// 用户画的标记（矩形/箭头/便签）单独一层，渲染在 PaneLayer **之后**。
//
// 为什么不能留在 CanvasStage 里加 z-index：标记原本挂在 .canvas-world 下，
// 那个元素带 transform、**自成层叠上下文** —— 在它内部无论调多高都压不到
// PaneLayer 之上（PaneLayer 在 App.tsx 里排在 CanvasStage 之后）。
// 标记的用途正是「指着某个终端说这块」，压在终端底下等于没有。

import { useMemo, useRef } from 'react'
import { useStore } from '../../store'
import type { CanvasShape } from '../../store'
import { attachBlurGuard } from '../../blurGuard'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { useCanvasWheelPassthrough } from './wheelPassthrough'
import { CanvasTodoBoards } from './CanvasTodoBoard'
// canvas.css 不在这里 import——它已经被 CanvasStage.tsx 引入一次（App.tsx 顶层无条件
// import 了 CanvasStage），本文件用到的 .canvas-shape-* 规则也加在同一份 canvas.css 里。

export function CanvasShapeLayer(): JSX.Element | null {
  const viewMode = useStore((s) => s.viewMode)
  const shapes = useStore((s) => s.canvas.shapes)
  const vp = useStore((s) => s.canvas.viewport)
  const canvasSel = useStore((s) => s.canvasSel)
  const toggleCanvasSel = useStore((s) => s.toggleCanvasSel)
  const updateShape = useStore((s) => s.updateShape)
  const sel = useMemo(() => new Set(canvasSel), [canvasSel])
  // tool / editingSticky 读 store，不是本组件私有 useState——CanvasStage 的工具条
  // 和 onViewportDown 守卫都要读同一份，两边各起一份的话彼此看不到对方的更新
  // （修复轮 1 的 Important 1/2，详见 store/canvas/types.ts 里这两个字段上方的注释）。
  const tool = useStore((s) => s.canvasTool)
  const editingSticky = useStore((s) => s.editingSticky)
  const setEditingSticky = useStore((s) => s.setEditingSticky)
  const maximized = !!useStore(liveMaximizedNode)
  const layerRef = useRef<HTMLDivElement>(null)

  // 滚轮：和画布模块同一条约定 —— 未选中的标记不该截断画板的平移/缩放。
  // 标记层是 .canvas-viewport 的兄弟节点，滚轮落在标记上传不过去，
  // 不接这一手的话「鼠标一挪到矩形上画布就滚不动了」。
  // 选中的才放行给内容（便签的长文本要能滚）。
  useCanvasWheelPassthrough(layerRef, viewMode === 'canvas' && !maximized, (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('.cshape') as HTMLElement | null
    const sid = el?.dataset.sid
    return !!sid && useStore.getState().canvasSel.includes('s:' + sid)
  })

  // 只在画布模式出现；有模块最大化沉浸时也让开（和右下角那两条同一个道理）
  if (viewMode !== 'canvas' || maximized) return null

  // CanvasStage 里 startShapeDrag 靠 selectElement 写选中态，这里原样跟一份
  // （它本身只是 toggleCanvasSel 的薄封装，不是要搬的三段之一，但被其中一段引用）
  const selectElement = (key: string, additive: boolean): void => {
    toggleCanvasSel(key, additive)
  }

  const startShapeDrag = (sh: CanvasShape, e: React.MouseEvent): void => {
    if (e.button !== 0 || tool !== 'select') return
    e.stopPropagation()
    selectElement('s:' + sh.id, e.shiftKey)
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const x0 = sh.x
    const y0 = sh.y
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void =>
      updateShape(sh.id, { x: x0 + (ev.clientX - sx) / scale, y: y0 + (ev.clientY - sy) / scale })
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 拖拽中真失焦 → 当场收尾，不留悬空监听；hide/show 抖动引起的假 blur 由
    // attachBlurGuard 过滤掉（见该文件注释），不会误伤正在进行的拖拽
    detachBlur = attachBlurGuard(onUp)
  }

  /** 图形的右下角缩放。便签原来只能在新建时拖出大小，之后就定死了 ——
   *  写长了的便签既看不全也改不了尺寸。 */
  const startShapeResize = (sh: CanvasShape, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const w0 = sh.w
    const h0 = sh.h
    let detachBlur = (): void => {}
    const onMove = (ev: MouseEvent): void =>
      updateShape(sh.id, {
        w: Math.max(120, w0 + (ev.clientX - sx) / scale),
        h: Math.max(60, h0 + (ev.clientY - sy) / scale)
      })
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      detachBlur()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // 拖拽中真失焦 → 当场收尾，不留悬空监听；hide/show 抖动引起的假 blur 由
    // attachBlurGuard 过滤掉（见该文件注释），不会误伤正在进行的拖拽
    detachBlur = attachBlurGuard(onUp)
  }

  const renderShape = (sh: Omit<CanvasShape, 'id'> & { id?: string }, isDraft = false): JSX.Element => {
    const id = sh.id ?? '__draft__'
    const left = Math.min(sh.x, sh.x + sh.w)
    const top = Math.min(sh.y, sh.y + sh.h)
    const w = Math.abs(sh.w)
    const h = Math.abs(sh.h)
    const selCls = !isDraft && sel.has('s:' + id) ? ' sel' : ''
    const onDown = (e: React.MouseEvent): void => {
      if (!isDraft) startShapeDrag(sh as CanvasShape, e)
    }
    if (sh.type === 'sticky') {
      const sw = Math.max(w, 120)
      const shh = Math.max(h, 60)
      if (!isDraft && editingSticky === id) {
        return (
          <textarea
            key={id}
            className="cshape cshape-sticky editing"
            style={{ left, top, width: sw, height: shh }}
            defaultValue={sh.text}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              updateShape(id, { text: e.target.value })
              setEditingSticky(null)
            }}
          />
        )
      }
      return (
        <div
          key={id}
          className={`cshape cshape-sticky${selCls}`}
          data-sid={id}
          style={{ left, top, width: sw, height: shh }}
          onMouseDown={(e) => {
            // 按在滚动条上时不要启动拖拽 —— 否则想翻内容，结果整个便签跟着鼠标跑
            const b = (e.target as HTMLElement).closest('.cshape-sticky-body') as HTMLElement | null
            if (b && b.scrollHeight > b.clientHeight && e.nativeEvent.offsetX > b.clientWidth) return
            onDown(e)
          }}
          onDoubleClick={() => !isDraft && setEditingSticky(id)}
        >
          {/* 文字单独一层：便签本体不滚，滚的是这里。
              本体要是可滚的，拖动便签时鼠标一动就会先滚内容 */}
          <div className="cshape-sticky-body">{sh.text}</div>
          {!isDraft && <div className="cshape-rz" onMouseDown={(e) => startShapeResize(sh as CanvasShape, e)} />}
        </div>
      )
    }
    if (sh.type === 'rect') {
      return (
        <div
          key={id}
          className={`cshape cshape-rect${selCls}`}
          data-sid={id}
          style={{ left, top, width: w, height: h }}
          onMouseDown={onDown}
        />
      )
    }
    // arrow
    const ax1 = sh.w >= 0 ? 0 : w
    const ay1 = sh.h >= 0 ? 0 : h
    const ax2 = sh.w >= 0 ? w : 0
    const ay2 = sh.h >= 0 ? h : 0
    return (
      <svg
        key={id}
        className={`cshape cshape-arrow${selCls}`}
        data-sid={id}
        style={{ left, top, width: Math.max(w, 2), height: Math.max(h, 2), overflow: 'visible' }}
        onMouseDown={onDown}
      >
        <defs>
          <marker id={`ah-${id}`} markerWidth="10" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--accent)" />
          </marker>
        </defs>
        <line
          x1={ax1}
          y1={ay1}
          x2={ax2}
          y2={ay2}
          stroke="var(--accent)"
          strokeWidth="2"
          markerEnd={`url(#ah-${id})`}
        />
      </svg>
    )
  }

  return (
    // .drawing（选着绘图工具时加）：这层的 .cshape 整体让出 pointer-events，
    // mousedown 才能穿透到底下的 .canvas-viewport 触发 onViewportDown 开始画新图形——
    // 不然落在一个已有图形上面永远只会选中/拖走那个旧图形，新图形一根画不出来
    // （修复轮 1 Important 1；.canvas-viewport 自己也用同名 .drawing 类切光标，
    // 两条规则各管各的选择器，互不影响）。
    <div ref={layerRef} className={`canvas-shape-layer${tool !== 'select' ? ' drawing' : ''}`}>
      <div
        className="canvas-shape-world"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})` }}
      >
        {shapes.map((sh) => renderShape(sh))}
        <CanvasTodoBoards />
      </div>
    </div>
  )
}
