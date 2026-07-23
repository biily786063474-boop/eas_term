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
  onChange
}: {
  kind: PaneKind
  onChange: (kind: PaneKind) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

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
        title="切换面板功能"
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
            {KIND_OPTIONS.map(({ kind: k, label, Icon }) => (
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
  const splitLeaf = useStore((s) => s.splitLeaf)
  const closeLeaf = useStore((s) => s.closeLeafSafely)
  const setActiveLeaf = useStore((s) => s.setActiveLeaf)
  const openChat = useStore((s) => s.openChat)
  const tabCwd = useStore((s) => s.tabs.find((t) => t.id === tabId)?.cwd ?? '')

  const pane = leaf.pane
  const hasFile = pane.kind === 'code' || pane.kind === 'image'
  const fileName = hasFile && pane.filePath ? pane.filePath.split('/').pop() : null

  // 画布模式：像素定位 + 整体位图缩放；分屏模式：百分比 rect
  const paneStyle: CSSProperties = canvasRect
    ? {
        display: hidden ? 'none' : undefined,
        left: canvasRect.left,
        top: canvasRect.top,
        width: canvasRect.w,
        height: canvasRect.h,
        transform: `scale(${canvasRect.scale})`,
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
    const { frameId, nodeId, nodeX, nodeY, scale } = canvasRect
    const sx = e.clientX
    const sy = e.clientY
    const onMove = (ev: MouseEvent): void =>
      moveNode(frameId, nodeId, nodeX + (ev.clientX - sx) / scale, nodeY + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`pane${isActive ? ' active' : ''}`}
      data-leaf-id={leaf.id}
      style={paneStyle}
      onMouseDown={canvasRect ? undefined : () => setActiveLeaf(tabId, leaf.id)}
    >
      <div
        className="pane-header"
        style={canvasRect ? { cursor: 'move' } : undefined}
        onMouseDown={canvasRect ? onCanvasHeadDown : undefined}
      >
        <PaneKindSelect
          kind={pane.kind}
          onChange={(k) => void setPaneKind(tabId, leaf.id, k)}
        />
        {fileName && (
          <span className="pane-file" title={hasFile ? (pane.filePath ?? '') : ''}>
            {fileName}
          </span>
        )}
        <span className="pane-spacer" />
        {pane.kind === 'terminal' && (
          <button
            className="icon-btn"
            title="Claude Code 对话导航"
            onClick={() => openChat(tabCwd)}
          >
            <MessageIcon />
          </button>
        )}
        <button
          className="icon-btn"
          title="向右分屏（⌘D）"
          onClick={() => void splitLeaf(tabId, leaf.id, 'row')}
        >
          <SplitHIcon />
        </button>
        <button
          className="icon-btn"
          title="向下分屏（⌘⇧D）"
          onClick={() => void splitLeaf(tabId, leaf.id, 'column')}
        >
          <SplitVIcon />
        </button>
        <button
          className="icon-btn"
          title="关闭面板（⌘W）"
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
    </div>
  )
}
