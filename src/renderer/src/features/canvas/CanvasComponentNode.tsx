// 画布组件节点（画布独有）：按 node.component.type 查注册表渲染，Frame 注入 projectId/cwd。
// 外壳（头部/拖动/resize）复用文件预览节点的 .cfile-* 样式。

import { useState, useRef } from 'react'
import { useStore } from '../../store'
import { useHidingHolder, useMaximizeFlip } from '../workspace/useFlip.ts'
import type { CanvasNode, CanvasFrame } from '../../store'
import { getCanvasComponent } from './components/registry'
import { makeSubframeDrop } from './subframeDrop'
import { MaximizeIcon, RestoreIcon } from '../../ui/Icons'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { dropModuleOnTerminal } from './dropOnTerminal'

export function CanvasComponentNode({
  frame,
  node,
  selected,
  onSelect
}: {
  frame: CanvasFrame
  node: CanvasNode
  selected?: boolean
  onSelect?: (additive: boolean) => void
}): JSX.Element | null {
  const moveNode = useStore((s) => s.moveNode)
  const settleNode = useStore((s) => s.settleNode)
  const resizeNode = useStore((s) => s.resizeNode)
  const settleResize = useStore((s) => s.settleResize)
  const removeNode = useStore((s) => s.removeNode)
  const maximizedNode = useStore(liveMaximizedNode)
  const setMaximizedNode = useStore((s) => s.setMaximizedNode)
  /** 最大化后的显示比例（双指捏合调）。**只有最大化的那个用得上** */
  const maxScale = useStore((s) => s.maxScale)
  const vp = useStore((s) => s.canvas.viewport)
  const isMax = maximizedNode?.frameId === frame.id && maximizedNode?.nodeId === node.id
  // 最大化：撑成「当前可视区」在世界坐标下的矩形（节点坐标相对 Frame）
  // **藏起来这件事要滞后**：还原时 55 个元素同一帧全部恢复显示，那一帧 50~120ms，
  // 正好压在收回动画头上（用户 2026-09-07：「回收动画会掉帧」）。推迟到动画放完再放出来
  // —— 它们在最大化期间本来就一直看不见，晚 260ms 出现不改变任何语义。
  // ⚠️ **只有它能用滞后值**；`isMax` 和最大化的几何必须用实时的 `maximizedNode`，
  // 否则被还原的那个节点会晚 260ms 才开始缩，动画就没了。
  const hold = useHidingHolder(maximizedNode ?? null)
  const hiddenByMax = !!hold && !(hold.frameId === frame.id && hold.nodeId === node.id)
  const maxStyle = ((): React.CSSProperties | null => {
    if (!isMax) return null
    const el = document.querySelector('.canvas-viewport') as HTMLElement | null
    const cw = el?.clientWidth ?? window.innerWidth
    const ch = el?.clientHeight ?? window.innerHeight
    return {
      left: -vp.x / vp.scale - frame.x,
      top: -vp.y / vp.scale - frame.y,
      width: cw / vp.scale,
      height: ch / vp.scale,
      zIndex: 200,
      // 最大化后的显示比例（双指捏合调）。挂成 CSS 变量给 `.cfile-body` 用 ——
      // **HTML 节点不吃这个**，它走 webview 自己的 setZoomFactor（见 canvas.css 那条）
      ['--max-scale' as string]: maxScale
    } as React.CSSProperties
  })()

  // ── 最大化 / 还原的丝滑动画 ──────────────────────────────────────────────
  // 用户 2026-09-07：「frame 中所有可以最大化窗口都要统一的放大缩小过度动效。」
  // 在这之前只有 PaneView（终端 / AI 对话）有，画布上的节点是瞬移。
  // **判据与曲线都在 `workspace/useFlip.ts`，四个模块共用一份**，别在这儿另写。
  // 被别人最大化盖住时传 null —— 那时 display:none，量出来是 0，倒推会得到 Infinity。
  const rootRef = useRef<HTMLDivElement>(null)
  useMaximizeFlip(
    rootRef,
    hiddenByMax
      ? null
      : maxStyle
        ? { left: maxStyle.left as number, top: maxStyle.top as number, w: maxStyle.width as number, h: maxStyle.height as number }
        : { left: node.x, top: node.y, w: node.w, h: node.h }
  )
  const renameNode = useStore((s) => s.renameNode)
  const [editing, setEditing] = useState(false)
  const project = useStore((s) => s.projects.find((p) => p.id === frame.projectId))
  const comp = node.component
  const def = comp ? getCanvasComponent(comp.type) : undefined
  if (!comp || !def) return null

  const startDrag = (e: React.MouseEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.stopPropagation()
    e.preventDefault()
    // 选中由根节点的 onMouseDownCapture 统一处理
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const x0 = node.x
    const y0 = node.y
    const drop = makeSubframeDrop(frame.id, node.id)
    const onMove = (ev: MouseEvent): void => {
      drop.track(ev.clientX, ev.clientY)
      if (drop.done) return
      moveNode(frame.id, node.id, x0 + (ev.clientX - sx) / scale, y0 + (ev.clientY - sy) / scale)
    }
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      drop.end()
      if (!drop.done) settleNode(frame.id, node.id)
      // 落到终端 → 插它所属项目的根路径（project 已经在组件顶部按 frame.projectId 解出来了）
      dropModuleOnTerminal(ev, project?.path)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startResize = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const w0 = node.w
    const h0 = node.h
    const onMove = (ev: MouseEvent): void =>
      resizeNode(frame.id, node.id, w0 + (ev.clientX - sx) / scale, h0 + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      settleResize(frame.id, node.id) // 松手让位，见 canvas/layout.ts 的 pushDownOverlaps
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={rootRef}
      className={`cfile-node${selected ? ' sel' : ''}${isMax ? ' is-max' : ''}`}
      data-node-id={node.id}
      data-frame-id={frame.id}
      /* 同 CanvasFileNode：只给角标选色相用 */
      data-kind={`c-${node.component?.type ?? ''}`}
      onMouseDownCapture={(e) => {
        if (!(e.target as HTMLElement).closest('button, input')) onSelect?.(e.shiftKey)
      }}
      // 冒泡阶段拦下，避免冒泡到 canvas-viewport 触发框选（其 onUp 会 clearCanvasSel 清掉选中）
      onMouseDown={(e) => e.stopPropagation()}
      style={
        maxStyle ??
        // 有别的节点最大化时把自己藏起来。不能只靠最大化节点的 z-index：
        // 浏览器节点是 <webview>（跨进程合成），永远浮在普通 DOM 之上，压不住。
        // 用 display:none 而不是不渲染，webview 的页面状态才不会丢。
        (hiddenByMax
          ? { display: 'none' }
          : { left: node.x, top: node.y, width: node.w, height: node.h })
      }
    >
      <div className="cfile-head" onMouseDown={startDrag} onDoubleClick={() => setEditing(true)}>
        <span className="cfile-badge">
          <def.Icon size={13} />
        </span>
        {editing ? (
          <input
            className="cfile-rename"
            defaultValue={node.name ?? def.name}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameNode(frame.id, node.id, e.target.value.trim() || def.name)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="cfile-title" data-tip={def.name}>
            {node.name ?? def.name}
          </span>
        )}
        <button
          className="cfile-btn"
          data-tip={isMax ? '还原到画布（Esc）' : '最大化沉浸'}
          onClick={() => setMaximizedNode(isMax ? null : { frameId: frame.id, nodeId: node.id })}
        >
          {isMax ? <RestoreIcon size={11} /> : <MaximizeIcon size={11} />}
        </button>
        <button className="cfile-x" data-tip="删除组件" onClick={() => removeNode(frame.id, node.id)}>
          ×
        </button>
      </div>
      <div className="cfile-body">
        {def.render({
          nodeId: node.id,
          frameId: frame.id,
          projectId: frame.projectId,
          cwd: project?.path ?? '',
          props: comp.props
        })}
      </div>
      <div className="cfile-rz" onMouseDown={startResize} />
    </div>
  )
}
