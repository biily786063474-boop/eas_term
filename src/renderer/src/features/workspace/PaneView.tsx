import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { LeafNode, PaneKind, Rect } from '../../layout'
import { TerminalView } from '../terminal/TerminalView'
import { CodeView } from '../editor/CodeView'
import { DiffView } from '../editor/DiffView'
import { ImageView } from '../image/ImageView'
import { HistoryView } from '../git/HistoryView'
import { ChatNavView } from '../chat/ChatNavView'
import { WebView } from '../web/WebView'
import { makeSubframeDrop } from '../canvas/subframeDrop'

// 词典懒加载：242 词条的内联 SVG bundle 有 368KB，不该进主包，首次打开词典面板才拉取
const DictView = lazy(() =>
  import('../dict/DictView').then((m) => ({ default: m.DictView }))
)
import {
  TerminalIcon,
  CodeIcon,
  ImageIcon,
  GitBranchIcon,
  MessageIcon,
  DictIcon,
  ChevronDownIcon,
  CloseIcon,
  SplitHIcon,
  SplitVIcon,
  CheckIcon,
  GlobeIcon
} from '../../ui/Icons'

const PANE_GAP = 3

// 下拉框可切换到的面板类型（不含 history —— 它只从侧栏「版本」打开）
const KIND_OPTIONS: { kind: PaneKind; label: string; Icon: typeof TerminalIcon }[] = [
  { kind: 'terminal', label: '终端', Icon: TerminalIcon },
  { kind: 'code', label: '代码预览', Icon: CodeIcon },
  { kind: 'image', label: '图片预览', Icon: ImageIcon },
  { kind: 'web', label: '网页', Icon: GlobeIcon },
  { kind: 'dict', label: '名词词典', Icon: DictIcon }
]

// 显示当前类型用（含 history，供头部展示）
const KIND_LABEL: Record<PaneKind, { label: string; Icon: typeof TerminalIcon }> = {
  terminal: { label: '终端', Icon: TerminalIcon },
  code: { label: '代码预览', Icon: CodeIcon },
  image: { label: '图片预览', Icon: ImageIcon },
  history: { label: '历史', Icon: GitBranchIcon },
  chat: { label: '对话', Icon: MessageIcon },
  dict: { label: '名词词典', Icon: DictIcon },
  web: { label: '网页', Icon: GlobeIcon }
}

function PaneKindSelect({
  kind,
  onChange,
  canvasMode
}: {
  kind: PaneKind
  onChange: (kind: PaneKind) => void
  /** 画布模式下排除「名词词典」——它改由悬浮气泡承载（且作为画布节点会崩溃） */
  canvasMode?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const options = canvasMode ? KIND_OPTIONS.filter((o) => o.kind !== 'dict') : KIND_OPTIONS

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (e.target instanceof Node && btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const current = KIND_LABEL[kind]

  return (
    <>
      <button
        ref={btnRef}
        className={`pane-kind-btn${open ? ' open' : ''}`}
        data-tip="切换面板功能"
        onClick={() => {
          const r = btnRef.current!.getBoundingClientRect()
          setMenuPos({ x: r.left, y: r.bottom + 6 })
          setOpen((v) => !v)
        }}
      >
        <current.Icon size={13} />
        <span>{current.label}</span>
        <ChevronDownIcon size={11} className="pane-kind-chevron" />
      </button>
      {open &&
        // Portal 到 body：玻璃面板的 backdrop-filter 会让 position:fixed
        // 相对面板定位并被 overflow:hidden 裁切，必须逃逸出去
        createPortal(
          <div className="glass-menu" style={{ left: menuPos.x, top: menuPos.y }}>
            {options.map(({ kind: k, label, Icon }) => (
              <button
                key={k}
                className={`glass-menu-item${k === kind ? ' selected' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setOpen(false)
                  if (k !== kind) onChange(k)
                }}
              >
                <Icon size={14} />
                <span>{label}</span>
                {k === kind && <CheckIcon size={12} className="glass-menu-check" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

/** 画布模式下节点的屏幕像素定位（世界坐标 × 视口换算的结果 + 拖动所需上下文） */
export interface CanvasPlacement {
  left: number
  top: number
  w: number
  h: number
  scale: number
  frameId: string
  nodeId: string
  nodeX: number
  nodeY: number
  /** 自定义名称（画布节点重命名） */
  name?: string
}

interface Props {
  tabId: string
  leaf: LeafNode
  rect: Rect
  isActive: boolean
  /** 隐藏但保持挂载（非激活 tab 或画布模式下的 leaf）——终端不断连的关键 */
  hidden?: boolean
  /** 画布模式定位；存在时用像素 + transform 缩放，否则用分屏百分比 rect */
  canvasRect?: CanvasPlacement
}

export function PaneView({ tabId, leaf, rect, isActive, hidden, canvasRect }: Props): JSX.Element {
  const setPaneKind = useStore((s) => s.setPaneKind)
  const moveNode = useStore((s) => s.moveNode)
  const resizeNode = useStore((s) => s.resizeNode)
  const splitLeaf = useStore((s) => s.splitLeaf)
  const closeLeaf = useStore((s) => s.closeLeafSafely)
  const setActiveLeaf = useStore((s) => s.setActiveLeaf)
  const openChat = useStore((s) => s.openChat)
  const tabCwd = useStore((s) => s.tabs.find((t) => t.id === tabId)?.cwd ?? '')
  const renameNode = useStore((s) => s.renameNode)
  const toggleCanvasSel = useStore((s) => s.toggleCanvasSel)
  const setViewport = useStore((s) => s.setViewport)
  const [editingName, setEditingName] = useState(false)
  const paneRef = useRef<HTMLDivElement>(null)
  // 画布模式下本终端节点的选中 key，供高亮 + 点选
  const selKey = canvasRect ? 'n:' + canvasRect.frameId + ':' + canvasRect.nodeId : ''
  const selected = useStore((s) => (selKey ? s.canvasSel.includes(selKey) : false))
  const isCanvas = !!canvasRect

  // 画布模式：滚轮落在本模块上时——「选中」才让模块内部（终端/预览）自己滚动，
  // 「未选中」则拦下滚轮平移/缩放画板（与画板空白处一致，鼠标经过模块不再抢走 pan）。
  // 终端浮在 pane-layer、滚轮不经 canvas-viewport，故这里在 pane 上加原生捕获监听（passive:false 方可 preventDefault）。
  useEffect(() => {
    const el = paneRef.current
    if (!el || !isCanvas) return
    const onWheel = (e: WheelEvent): void => {
      if (selKey && useStore.getState().canvasSel.includes(selKey)) return // 选中 → 放行给模块内容
      e.preventDefault()
      e.stopPropagation()
      const cur = useStore.getState().canvas.viewport
      if (e.ctrlKey) {
        const vp = document.querySelector('.canvas-viewport')?.getBoundingClientRect()
        if (!vp) return
        const px = e.clientX - vp.left
        const py = e.clientY - vp.top
        const s2 = Math.min(2.2, Math.max(0.2, cur.scale * (1 - e.deltaY * 0.01)))
        setViewport({
          scale: s2,
          x: px - (px - cur.x) * (s2 / cur.scale),
          y: py - (py - cur.y) * (s2 / cur.scale)
        })
      } else {
        setViewport({ x: cur.x - e.deltaX, y: cur.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [isCanvas, selKey, setViewport])

  const pane = leaf.pane
  const hasFile = pane.kind === 'code' || pane.kind === 'image'
  const fileName = hasFile && pane.filePath ? pane.filePath.split('/').pop() : null

  const cs = canvasRect?.scale ?? 1
  // 画布终端走「字体缩放」而非 CSS transform：终端 pane 用实际像素尺寸、不变形，
  // 字号按 cs 放大（TerminalView 内），使 xterm 鼠标坐标精准；头部用 zoom 缩放（布局感知、按钮仍可点）。
  const canvasTerm = !!canvasRect && pane.kind === 'terminal'

  // 画布模式：终端=实际像素尺寸(无变形)；其它节点=像素定位 + 整体位图缩放；分屏=百分比 rect
  const paneStyle: CSSProperties = canvasRect
    ? canvasTerm
      ? {
          display: hidden ? 'none' : undefined,
          left: canvasRect.left,
          top: canvasRect.top,
          width: canvasRect.w * cs,
          height: canvasRect.h * cs
        }
      : {
          display: hidden ? 'none' : undefined,
          left: canvasRect.left,
          top: canvasRect.top,
          width: canvasRect.w,
          height: canvasRect.h,
          transform: `scale(${cs})`,
          transformOrigin: '0 0'
        }
    : {
        display: hidden ? 'none' : undefined,
        left: `calc(${rect.x * 100}% + ${PANE_GAP}px)`,
        top: `calc(${rect.y * 100}% + ${PANE_GAP}px)`,
        width: `calc(${rect.w * 100}% - ${PANE_GAP * 2}px)`,
        height: `calc(${rect.h * 100}% - ${PANE_GAP * 2}px)`
      }

  // 画布模式下拖动节点头部 → 改节点相对坐标（moveNode）
  const onCanvasHeadDown = (e: React.MouseEvent): void => {
    if (!canvasRect || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    // 选中由 pane 的 onMouseDownCapture 统一处理
    const { frameId, nodeId, nodeX, nodeY, scale } = canvasRect
    const sx = e.clientX
    const sy = e.clientY
    const drop = makeSubframeDrop(frameId, nodeId)
    const onMove = (ev: MouseEvent): void => {
      drop.track(ev.clientX, ev.clientY) // 悬停子 Frame 1s → 移入
      if (drop.done) return
      moveNode(frameId, nodeId, nodeX + (ev.clientX - sx) / scale, nodeY + (ev.clientY - sy) / scale)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      drop.end()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 画布模式下拖右下角 → 调节节点尺寸（终端会经 ResizeObserver 自动 fit 重算行列）
  const onCanvasResize = (e: React.MouseEvent): void => {
    if (!canvasRect || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const { frameId, nodeId, w, h, scale } = canvasRect
    const sx = e.clientX
    const sy = e.clientY
    const onMove = (ev: MouseEvent): void =>
      resizeNode(frameId, nodeId, w + (ev.clientX - sx) / scale, h + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={paneRef}
      className={`pane${isActive ? ' active' : ''}${selected ? ' sel' : ''}`}
      data-leaf-id={leaf.id}
      style={paneStyle}
      onMouseDown={canvasRect ? undefined : () => setActiveLeaf(tabId, leaf.id)}
      // 画布：点终端任意部分即选中该模块（捕获阶段，不 preventDefault 故仍可在终端里输入/选字）
      onMouseDownCapture={
        canvasRect && selKey
          ? (e) => {
              if (!(e.target as HTMLElement).closest('button, input'))
                toggleCanvasSel(selKey, e.shiftKey)
            }
          : undefined
      }
    >
      <div
        className="pane-header"
        style={
          canvasRect
            ? // 画布终端：头部用 zoom 随缩放（布局感知，按钮仍精准可点），body 不变形供 xterm 精准取坐标
              canvasTerm
              ? { cursor: 'move', zoom: cs }
              : { cursor: 'move' }
            : undefined
        }
        onMouseDown={canvasRect ? onCanvasHeadDown : undefined}
      >
        <PaneKindSelect
          kind={pane.kind}
          canvasMode={!!canvasRect}
          onChange={(k) => void setPaneKind(tabId, leaf.id, k)}
        />
        {canvasRect &&
          (editingName ? (
            <input
              className="pane-node-rename"
              defaultValue={canvasRect.name ?? ''}
              autoFocus
              placeholder="命名此模块"
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                renameNode(canvasRect.frameId, canvasRect.nodeId, e.target.value.trim())
                setEditingName(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditingName(false)
              }}
            />
          ) : (
            <span
              className="pane-node-name"
              data-tip="双击重命名"
              onDoubleClick={() => setEditingName(true)}
            >
              {canvasRect.name || '未命名'}
            </span>
          ))}
        {fileName && (
          <span className="pane-file" data-tip={hasFile ? (pane.filePath ?? '') : ''}>
            {fileName}
          </span>
        )}
        <span className="pane-spacer" />
        {pane.kind === 'terminal' && (
          <button
            className="icon-btn"
            data-tip="Claude Code 对话导航"
            onClick={() => openChat(tabCwd)}
          >
            <MessageIcon />
          </button>
        )}
        <button
          className="icon-btn"
          data-tip="向右分屏（⌘D）"
          onClick={() => void splitLeaf(tabId, leaf.id, 'row')}
        >
          <SplitHIcon />
        </button>
        <button
          className="icon-btn"
          data-tip="向下分屏（⌘⇧D）"
          onClick={() => void splitLeaf(tabId, leaf.id, 'column')}
        >
          <SplitVIcon />
        </button>
        <button
          className="icon-btn"
          data-tip="关闭面板（⌘W）"
          onClick={() => closeLeaf(tabId, leaf.id)}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="pane-body">
        {pane.kind === 'terminal' && (
          <TerminalView
            key={pane.ptyId}
            tabId={tabId}
            leafId={leaf.id}
            ptyId={pane.ptyId}
            isActive={isActive}
            canvasScale={canvasTerm ? cs : 1}
          />
        )}
        {pane.kind === 'code' &&
          (pane.diff ? (
            <DiffView cwd={pane.diff.cwd} relPath={pane.diff.relPath} mode={pane.diff.mode} />
          ) : (
            <CodeView filePath={pane.filePath} />
          ))}
        {pane.kind === 'image' && <ImageView filePath={pane.filePath} />}
        {pane.kind === 'history' && <HistoryView cwd={pane.cwd} />}
        {pane.kind === 'chat' && <ChatNavView cwd={pane.cwd} />}
        {pane.kind === 'dict' && (
          <Suspense fallback={<div className="pane-placeholder">加载词典…</div>}>
            <DictView />
          </Suspense>
        )}
        {pane.kind === 'web' && <WebView url={pane.url} />}
      </div>
      {canvasRect && <div className="pane-rz" onMouseDown={onCanvasResize} />}
    </div>
  )
}
