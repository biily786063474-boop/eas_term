// 四个视图收进一个按钮。三段控件到第四项就装不下了 —— 标题栏中间那块宽度有限，
// 再塞一段会把窗口标题挤掉。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useStore } from '../../store'
import type { ViewMode } from '../../store/canvas/types'
// 大写 I —— 文件就叫 Icons.tsx。
// 注意 IconProps 在那个文件里**没有 export**（第 4 行是裸 interface），
// 所以这里用 typeof 取一个现成图标的类型，别去 import 它。
import { TerminalIcon, CanvasIcon, BoardIcon, GanttIcon } from '../../ui/Icons'

const MODES: { key: ViewMode; label: string; Icon: typeof BoardIcon }[] = [
  { key: 'split', label: '终端', Icon: TerminalIcon },
  { key: 'canvas', label: '画布', Icon: CanvasIcon },
  { key: 'board', label: '看板', Icon: BoardIcon },
  { key: 'gantt', label: '甘特图', Icon: GanttIcon }
]

export function ModeSwitch(): JSX.Element {
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 菜单必须 portal 到 body：.titlebar 是 overflow:hidden，挂在它底下的绝对定位
  // 下拉会被裁掉——点上去只会点穿到裁剪区域后面的终端（同一个坑 McpIndicator 已经
  // 踩过，见那个文件顶部注释）。portal 之后 DOM 上菜单不再是按钮的子节点，
  // 所以位置得在打开那一刻用按钮的 rect 现算，「点外面关掉」也要分开判两个 ref。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const cur = MODES.find((m) => m.key === viewMode) ?? MODES[0]

  return (
    <div className="mode-switch-wrap">
      <button
        ref={btnRef}
        className={`mode-switch${open ? ' on' : ''}`}
        onClick={() => {
          const r = btnRef.current!.getBoundingClientRect()
          setPos({ x: r.left, y: r.bottom + 6 })
          setOpen((v) => !v)
        }}
        data-tip="模式切换"
      >
        <cur.Icon size={13} />
        {cur.label}
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="mode-menu" ref={menuRef} style={{ left: pos.x, top: pos.y }}>
            {MODES.map((m) => (
              <button
                key={m.key}
                className={`mode-menu-item${m.key === viewMode ? ' on' : ''}`}
                onClick={() => {
                  setViewMode(m.key)
                  setOpen(false)
                }}
              >
                <m.Icon size={13} />
                {m.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
