// 画布独有的文件预览节点（不进分屏）：渲染在装饰层 world 内，随视口矢量缩放。
// 内容复用 CodeView / ImageView / WebView；头部可拖动、右下可 resize、× 删除。

import { useState } from 'react'
import { useStore } from '../../store'
import type { CanvasNode } from '../../store'
import { CodeView } from '../editor/CodeView'
import { WebView } from '../web/WebView'
import { CanvasImageViewer } from './CanvasImageViewer'
import { CodeIcon, ImageIcon, GlobeIcon, CopyIcon, PlayIcon } from '../../ui/Icons'
import { easfileUrl, isVideoPath } from './media'
import { makeSubframeDrop } from './subframeDrop'

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
  const settleNode = useStore((s) => s.settleNode)
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

  // web 节点头部：页面标题优先，其次主机名/文件名，最后「网页」（手动 node.name 更优先，见下方 ?? ）
  const webLabel = (): string => {
    if (pane.kind !== 'web') return '网页'
    if (pane.title) return pane.title
    if (!pane.url) return '网页'
    try {
      const u = new URL(pane.url)
      return u.protocol === 'file:' ? (u.pathname.split('/').pop() || pane.url) : u.hostname
    } catch {
      return pane.url
    }
  }
  const fileName =
    pane.kind === 'web'
      ? webLabel()
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
  const isVid = pane.kind === 'image' && !!pane.filePath && isVideoPath(pane.filePath)
  const Icon = isVid
    ? PlayIcon
    : pane.kind === 'image'
      ? ImageIcon
      : pane.kind === 'web'
        ? GlobeIcon
        : CodeIcon

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
    const drop = makeSubframeDrop(frameId, node.id)
    const onMove = (ev: MouseEvent): void => {
      drop.track(ev.clientX, ev.clientY) // 悬停子 Frame 1s → 移入
      if (drop.done) return
      moveNode(frameId, node.id, x0 + (ev.clientX - sx) / scale, y0 + (ev.clientY - sy) / scale)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      drop.end()
      if (!drop.done) settleNode(frameId, node.id) // 未移入子 Frame → 松手若与他人重叠则挪开
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
      // 点模块任意部分即选中（捕获阶段，早于内容；不 preventDefault 故内容交互照常）
      onMouseDownCapture={(e) => {
        if (!(e.target as HTMLElement).closest('button, input')) onSelect?.(e.shiftKey)
      }}
      // 冒泡阶段拦下，避免事件冒泡到 canvas-viewport 触发框选（其 onUp 会 clearCanvasSel 把选中清掉）
      onMouseDown={(e) => e.stopPropagation()}
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
        {pane.kind === 'image' &&
          (isVid ? (
            <video
              className="cfile-video"
              src={easfileUrl(pane.filePath!)}
              controls
              loop
              playsInline
            />
          ) : (
            <CanvasImageViewer filePath={pane.filePath} />
          ))}
        {pane.kind === 'web' && (
          <WebView url={pane.url} frameId={frameId} nodeId={node.id} selected={selected} />
        )}
      </div>
      <div className="cfile-rz" onMouseDown={startResize} />
    </div>
  )
}
