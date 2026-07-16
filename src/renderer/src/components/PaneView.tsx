import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import type { LeafNode, PaneKind, Rect } from '../layout'
import { TerminalView } from './TerminalView'
import { CodeView } from './CodeView'
import { DiffView } from './DiffView'
import { ImageView } from './ImageView'
import { HistoryView } from './HistoryView'
import { ChatNavView } from './ChatNavView'
import { DictView } from './DictView'
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
  CheckIcon
} from './Icons'

const PANE_GAP = 3

// 下拉框可切换到的面板类型（不含 history —— 它只从侧栏「版本」打开）
const KIND_OPTIONS: { kind: PaneKind; label: string; Icon: typeof TerminalIcon }[] = [
  { kind: 'terminal', label: '终端', Icon: TerminalIcon },
  { kind: 'code', label: '代码预览', Icon: CodeIcon },
  { kind: 'image', label: '图片预览', Icon: ImageIcon },
  { kind: 'dict', label: '名词词典', Icon: DictIcon }
]

// 显示当前类型用（含 history，供头部展示）
const KIND_LABEL: Record<PaneKind, { label: string; Icon: typeof TerminalIcon }> = {
  terminal: { label: '终端', Icon: TerminalIcon },
  code: { label: '代码预览', Icon: CodeIcon },
  image: { label: '图片预览', Icon: ImageIcon },
  history: { label: '历史', Icon: GitBranchIcon },
  chat: { label: '对话', Icon: MessageIcon },
  dict: { label: '名词词典', Icon: DictIcon }
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

interface Props {
  tabId: string
  leaf: LeafNode
  rect: Rect
  isActive: boolean
}

export function PaneView({ tabId, leaf, rect, isActive }: Props): JSX.Element {
  const setPaneKind = useStore((s) => s.setPaneKind)
  const splitLeaf = useStore((s) => s.splitLeaf)
  const closeLeaf = useStore((s) => s.closeLeafSafely)
  const setActiveLeaf = useStore((s) => s.setActiveLeaf)
  const openChat = useStore((s) => s.openChat)
  const tabCwd = useStore((s) => s.tabs.find((t) => t.id === tabId)?.cwd ?? '')

  const pane = leaf.pane
  const hasFile = pane.kind === 'code' || pane.kind === 'image'
  const fileName = hasFile && pane.filePath ? pane.filePath.split('/').pop() : null

  return (
    <div
      className={`pane${isActive ? ' active' : ''}`}
      style={{
        left: `calc(${rect.x * 100}% + ${PANE_GAP}px)`,
        top: `calc(${rect.y * 100}% + ${PANE_GAP}px)`,
        width: `calc(${rect.w * 100}% - ${PANE_GAP * 2}px)`,
        height: `calc(${rect.h * 100}% - ${PANE_GAP * 2}px)`
      }}
      onMouseDown={() => setActiveLeaf(tabId, leaf.id)}
    >
      <div className="pane-header">
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
        {pane.kind === 'dict' && <DictView />}
      </div>
    </div>
  )
}
