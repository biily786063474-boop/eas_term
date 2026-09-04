// 自由文件预览节点：不属于任何 Frame，直接浮在画布世界坐标上（拖知识库文件到画布任意位置生成）。
// 是 CanvasFileNode 的自由坐标版：世界坐标不用叠加 Frame 偏移，也没有「悬停子 Frame 转移归属」
// 这回事，所以没有直接复用那个组件，改成单独一份——两者共享同一套 CSS 类名，长得一样。
// 可不可写由节点自己带的标记决定，不是这个组件的立场：
//   知识库拖出来的 → readOnly（内容离开知识库目录不该被顺手改掉）
//   skill 面板拖出来的 → 可写，且保存走 writeVia 指定的通道（见下面 saveVia）

import { useState } from 'react'
import { useStore } from '../../store'
import type { CanvasNode } from '../../store'
import { CodeView } from '../editor/CodeView'
import { WebView } from '../web/WebView'
import { CanvasImageViewer } from './CanvasImageViewer'
import { CodeIcon, ImageIcon, GlobeIcon, CopyIcon, PlayIcon, MaximizeIcon, RestoreIcon } from '../../ui/Icons'
import { easfileUrl, isVideoPath } from './media'
import { useIdleVideoPause } from './useIdleVideoPause'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { dropModuleOnTerminal } from './dropOnTerminal'

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
  const maximizedNode = useStore(liveMaximizedNode)
  const setMaximizedNode = useStore((s) => s.setMaximizedNode)
  /** 最大化后的显示比例（双指捏合调）。**只有最大化的那个用得上** */
  const maxScale = useStore((s) => s.maxScale)
  const vp = useStore((s) => s.canvas.viewport)
  const isMax = !maximizedNode?.frameId && maximizedNode?.nodeId === node.id
  const hiddenByMax = !!maximizedNode && !isMax
  // 同 CanvasFileNode：看别处时暂停，省掉后台白解码
  const videoRef = useIdleVideoPause(!!selected && !hiddenByMax)
  // 最大化：世界坐标节点没有 Frame 偏移要减，比 CanvasFileNode 简单一档
  const maxStyle = ((): React.CSSProperties | null => {
    if (!isMax) return null
    const el = document.querySelector('.canvas-viewport') as HTMLElement | null
    const cw = el?.clientWidth ?? window.innerWidth
    const ch = el?.clientHeight ?? window.innerHeight
    return {
      left: -vp.x / vp.scale,
      top: -vp.y / vp.scale,
      width: cw / vp.scale,
      height: ch / vp.scale,
      zIndex: 200,
      // 最大化后的显示比例（双指捏合调）。**HTML 节点不吃这个**，
      // 它走 webview 自己的 setZoomFactor（见 canvas.css 那条）
      ['--max-scale' as string]: maxScale
    } as React.CSSProperties
  })()
  const [editing, setEditing] = useState(false)
  // skill 面板拖出来的文件走自己的写入口：那些文件在 `~/.claude/skills` 这类位置，
  // fs:writeTextFile 过 fsGuard（只认项目根和知识库根），保存会被挡下来。
  // 见 main/skillLibrary/write.ts 的文件头——那条口子有自己的、更窄的边界。
  const saveVia = node.writeVia === 'skill' ? window.api.skillLibrary.writeFile : undefined
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
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      settleFreeNode(node.id) // 松手若与别的自由节点重叠则挪开（不避 Frame——自由节点允许压在 Frame 上）
      // 自由节点不属于任何 Frame，没有 projectId 可查——只能按路径前缀猜它是不是躺在
      // 某个项目根目录下面（跟 pathLinks.ts 的 relativeToProject 同一个惯用法，那边只认
      // activeProject 一个，这里要在全部项目里找，所以没直接复用那个函数）。
      // 猜不出（不在任何项目目录下、或者这节点根本不是文件/没有 absPath）就传 undefined，
      // dropModuleOnTerminal 会老实地什么都不插，只留移动。
      const projectPath = absPath
        ? useStore
            .getState()
            .projects.find((p) => absPath === p.path || absPath.startsWith(p.path + '/'))?.path
        : undefined
      dropModuleOnTerminal(ev, projectPath)
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
      className={`cfile-node cfile-node-free${selected ? ' sel' : ''}${isMax ? ' is-max' : ''}`}
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
        {pane.kind === 'code' && (
          <CodeView filePath={pane.filePath} readOnly={node.readOnly} saveVia={saveVia} />
        )}
        {pane.kind === 'image' &&
          (isVid ? (
            <video
              ref={videoRef}
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
          <WebView url={pane.url} free nodeId={node.id} selected={selected} zoom={isMax ? maxScale : 1} />
        )}
      </div>
      <div className="cfile-rz" onMouseDown={startResize} />
    </div>
  )
}
