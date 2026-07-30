// 自由文件预览节点：不属于任何 Frame，直接浮在画布世界坐标上（拖知识库文件到画布任意位置生成）。
// 是 CanvasFileNode 的自由坐标版：世界坐标不用叠加 Frame 偏移，也没有「悬停子 Frame 转移归属」
// 这回事，所以没有直接复用那个组件，改成单独一份——两者共享同一套 CSS 类名，长得一样。
// 内容一律只读（knowledge base 拖出来的东西离开知识库目录不该被顺手改掉），CodeView 传 readOnly。

import { useState } from 'react'
import { useStore } from '../../store'
import type { CanvasNode } from '../../store'
import { CodeView } from '../editor/CodeView'
import { WebView } from '../web/WebView'
import { CanvasImageViewer } from './CanvasImageViewer'
import { CodeIcon, ImageIcon, GlobeIcon, CopyIcon, PlayIcon, MaximizeIcon, RestoreIcon } from '../../ui/Icons'
import { easfileUrl, isVideoPath } from './media'

export function CanvasFreeFileNode({
  node,
  selected,
  onSelect
}: {
  node: CanvasNode
  selected?: boolean
  onSelect?: (additive: boolean) => void
}): JSX.Element | null {
  const moveFreeNode = useStore((s) => s.moveFreeNode)
  const settleFreeNode = useStore((s) => s.settleFreeNode)
  const resizeFreeNode = useStore((s) => s.resizeFreeNode)
  const removeFreeNode = useStore((s) => s.removeFreeNode)
  const renameFreeNode = useStore((s) => s.renameFreeNode)
  const maximizedNode = useStore((s) => s.maximizedNode)
  const setMaximizedNode = useStore((s) => s.setMaximizedNode)
  const vp = useStore((s) => s.canvas.viewport)
  const isMax = !maximizedNode?.frameId && maximizedNode?.nodeId === node.id
  const hiddenByMax = !!maximizedNode && !isMax
  // 最大化：世界坐标节点没有 Frame 偏移要减，比 CanvasFileNode 简单一档
  const maxStyle = ((): React.CSSProperties | null => {
    if (!isMax) return null
    const el = document.querySelector('.canvas-viewport') as HTMLElement | null
    const cw = el?.clientWidth ?? window.innerWidth
    const ch = el?.clientHeight ?? window.innerHeight
    return { left: -vp.x / vp.scale, top: -vp.y / vp.scale, width: cw / vp.scale, height: ch / vp.scale, zIndex: 200 }
  })()
  const [editing, setEditing] = useState(false)
  const pane = node.pane
  if (!pane) return null

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
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const x0 = node.x
    const y0 = node.y
    const onMove = (ev: MouseEvent): void => {
      moveFreeNode(node.id, x0 + (ev.clientX - sx) / scale, y0 + (ev.clientY - sy) / scale)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      settleFreeNode(node.id) // 松手若与别的自由节点重叠则挪开（不避 Frame——自由节点允许压在 Frame 上）
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
      resizeFreeNode(node.id, w0 + (ev.clientX - sx) / scale, h0 + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`cfile-node cfile-node-free${selected ? ' sel' : ''}`}
      data-node-id={node.id}
      onMouseDownCapture={(e) => {
        if (!(e.target as HTMLElement).closest('button, input')) onSelect?.(e.shiftKey)
      }}
      onMouseDown={(e) => e.stopPropagation()}
      style={
        maxStyle ??
        (hiddenByMax ? { display: 'none' } : { left: node.x, top: node.y, width: node.w, height: node.h })
      }
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
              renameFreeNode(node.id, e.target.value.trim() || fileName)
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
          <button
            className="cfile-btn"
            data-tip="复制路径"
            onClick={() => void window.api.clipboard.writeText(absPath)}
          >
            <CopyIcon size={11} />
          </button>
        )}
        <button
          className="cfile-btn"
          data-tip={isMax ? '还原到画布（Esc）' : '最大化沉浸'}
          onClick={() => setMaximizedNode(isMax ? null : { nodeId: node.id })}
        >
          {isMax ? <RestoreIcon size={11} /> : <MaximizeIcon size={11} />}
        </button>
        <button className="cfile-x" data-tip="删除节点" onClick={() => removeFreeNode(node.id)}>
          ×
        </button>
      </div>
      <div className="cfile-body">
        {pane.kind === 'code' && <CodeView filePath={pane.filePath} readOnly={node.readOnly} />}
        {pane.kind === 'image' &&
          (isVid ? (
            <video className="cfile-video" src={easfileUrl(pane.filePath!)} controls loop playsInline />
          ) : (
            <CanvasImageViewer filePath={pane.filePath} />
          ))}
        {pane.kind === 'web' && <WebView url={pane.url} free nodeId={node.id} selected={selected} />}
      </div>
      <div className="cfile-rz" onMouseDown={startResize} />
    </div>
  )
}
