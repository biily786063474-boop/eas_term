// 画布独有的文件预览节点（不进分屏）：渲染在装饰层 world 内，随视口矢量缩放。
// 内容复用 CodeView / ImageView / WebView；头部可拖动、右下可 resize、× 删除。

import { useStore } from '../../store'
import type { CanvasNode } from '../../store'
import { CodeView } from '../editor/CodeView'
import { ImageView } from '../image/ImageView'
import { WebView } from '../web/WebView'
import { CodeIcon, ImageIcon, GlobeIcon } from '../../ui/Icons'

export function CanvasFileNode({
  frameId,
  node
}: {
  frameId: string
  node: CanvasNode
}): JSX.Element | null {
  const moveNode = useStore((s) => s.moveNode)
  const resizeNode = useStore((s) => s.resizeNode)
  const removeNode = useStore((s) => s.removeNode)
  const pane = node.pane
  if (!pane) return null

  const title =
    pane.kind === 'web'
      ? (pane.url ?? '网页')
      : pane.kind === 'code' || pane.kind === 'image'
        ? (pane.filePath?.split('/').pop() ?? '未命名')
        : '预览'
  const Icon = pane.kind === 'image' ? ImageIcon : pane.kind === 'web' ? GlobeIcon : CodeIcon

  const startDrag = (e: React.MouseEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.stopPropagation()
    e.preventDefault()
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
      className="cfile-node"
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
    >
      <div className="cfile-head" onMouseDown={startDrag}>
        <Icon size={11} />
        <span className="cfile-title" title={title}>
          {title}
        </span>
        <button
          className="cfile-x"
          title="删除节点"
          onClick={() => removeNode(frameId, node.id)}
        >
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
