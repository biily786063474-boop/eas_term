// 画布独有的文件预览节点（不进分屏）：渲染在装饰层 world 内，随视口矢量缩放。
// 内容复用 CodeView / ImageView / WebView；头部可拖动、右下可 resize、× 删除。

import { useState } from 'react'
import { useStore } from '../../store'
import type { CanvasNode } from '../../store'
import { CodeView } from '../editor/CodeView'
import { ImageView } from '../image/ImageView'
import { WebView } from '../web/WebView'
import { CodeIcon, ImageIcon, GlobeIcon, CopyIcon } from '../../ui/Icons'

export function CanvasFileNode({
  frameId,
  node,
  selected,
  onSelect
}: {
  frameId: string
  node: CanvasNode
  selected?: boolean
  onSelect?: (additive: boolean) => void
}): JSX.Element | null {
  const moveNode = useStore((s) => s.moveNode)
  const resizeNode = useStore((s) => s.resizeNode)
  const removeNode = useStore((s) => s.removeNode)
  const renameNode = useStore((s) => s.renameNode)
  const projectPath = useStore((s) => {
    const fr = s.canvas.frames.find((f) => f.id === frameId)
    return s.projects.find((p) => p.id === fr?.projectId)?.path ?? ''
  })
  const [editing, setEditing] = useState(false)
  const pane = node.pane
  if (!pane) return null

  const fileName =
    pane.kind === 'web'
      ? (pane.url ?? '网页')
      : pane.kind === 'code' || pane.kind === 'image'
        ? (pane.filePath?.split('/').pop() ?? '未命名')
        : '预览'
  const absPath =
    pane.kind === 'web'
      ? (pane.url ?? '')
      : pane.kind === 'code' || pane.kind === 'image'
        ? (pane.filePath ?? '')
        : ''
  const relPath =
    projectPath && absPath.startsWith(projectPath + '/') ? absPath.slice(projectPath.length + 1) : absPath
  const Icon = pane.kind === 'image' ? ImageIcon : pane.kind === 'web' ? GlobeIcon : CodeIcon

  const startDrag = (e: React.MouseEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.stopPropagation()
    e.preventDefault()
    onSelect?.(e.shiftKey)
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const x0 = node.x
    const y0 = node.y
    const onMove = (ev: MouseEvent): void =>
      moveNode(frameId, node.id, x0 + (ev.clientX - sx) / scale, y0 + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
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
      resizeNode(frameId, node.id, w0 + (ev.clientX - sx) / scale, h0 + (ev.clientY - sy) / scale)
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
      data-frame-id={frameId}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
    >
      <div className="cfile-head" onMouseDown={startDrag} onDoubleClick={() => setEditing(true)}>
        <Icon size={11} />
        {editing ? (
          <input
            className="cfile-rename"
            defaultValue={node.name ?? fileName}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameNode(frameId, node.id, e.target.value.trim() || fileName)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="cfile-title" data-tip={absPath || fileName}>
            {node.name ?? fileName}
          </span>
        )}
        {absPath && (
          <>
            <button
              className="cfile-btn"
              data-tip="复制绝对路径"
              onClick={() => void window.api.clipboard.writeText(absPath)}
            >
              <CopyIcon size={11} />
            </button>
            <button
              className="cfile-btn cfile-btn-rel"
              data-tip="复制相对路径"
              onClick={() => void window.api.clipboard.writeText(relPath)}
            >
              <CopyIcon size={11} />
            </button>
          </>
        )}
        <button className="cfile-x" data-tip="删除节点" onClick={() => removeNode(frameId, node.id)}>
          ×
        </button>
      </div>
      <div className="cfile-body">
        {pane.kind === 'code' && <CodeView filePath={pane.filePath} />}
        {pane.kind === 'image' && <ImageView filePath={pane.filePath} />}
        {pane.kind === 'web' && <WebView url={pane.url} />}
      </div>
      <div className="cfile-rz" onMouseDown={startResize} />
    </div>
  )
}
