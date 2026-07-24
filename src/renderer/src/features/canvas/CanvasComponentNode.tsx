// 画布组件节点（画布独有）：按 node.component.type 查注册表渲染，Frame 注入 projectId/cwd。
// 外壳（头部/拖动/resize）复用文件预览节点的 .cfile-* 样式。

import { useState } from 'react'
import { useStore } from '../../store'
import type { CanvasNode, CanvasFrame } from '../../store'
import { getCanvasComponent } from './components/registry'
import { makeSubframeDrop } from './subframeDrop'

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
  const removeNode = useStore((s) => s.removeNode)
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
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      drop.end()
      if (!drop.done) settleNode(frame.id, node.id)
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
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`cfile-node${selected ? ' sel' : ''}`}
      data-node-id={node.id}
      data-frame-id={frame.id}
      onMouseDownCapture={(e) => {
        if (!(e.target as HTMLElement).closest('button, input')) onSelect?.(e.shiftKey)
      }}
      // 冒泡阶段拦下，避免冒泡到 canvas-viewport 触发框选（其 onUp 会 clearCanvasSel 清掉选中）
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
    >
      <div className="cfile-head" onMouseDown={startDrag} onDoubleClick={() => setEditing(true)}>
        <def.Icon size={11} />
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
