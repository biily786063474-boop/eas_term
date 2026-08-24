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
// 夹回可视区的定位逻辑不重写——画布右键菜单已经踩过同一个坑（0.4.11「启动」回溯确认框
// 越出窗口右边缘）并留下了通用解法，这里直接复用，不重复发明。
import { useMenuAnchor } from '../canvas/CanvasContextMenu'

const MODES: { key: ViewMode; label: string; Icon: typeof BoardIcon }[] = [
  { key: 'split', label: '分屏', Icon: TerminalIcon },
  { key: 'canvas', label: '画布', Icon: CanvasIcon },
  { key: 'board', label: '看板', Icon: BoardIcon },
  { key: 'gantt', label: '甘特图', Icon: GanttIcon }
]

/** 下拉菜单本体，独立成子组件、只在 open 时挂载——这不是随手拆分，是
 *  useMenuAnchor 能正常工作的前提：它内部"先 hidden、量完真实尺寸再夹回可视区
 *  显示"那套防闪烁机制，靠的是自己的 pos 状态从 null 起步（见该文件定义处注释：
 *  "实测尺寸而非估算"）。如果把这个 hook 直接放在常驻不销毁的 ModeSwitch 里调用，
 *  第二次打开时 pos 还留着上一次算好的旧坐标（可能是在另一个窗口宽度下算的），
 *  会先在旧坐标闪一帧、layout effect 跑完才跳到新坐标——正是这个 hook 想避免的
 *  那种"先飞出去再跳回来"。拆成子组件后每次 open 都是全新 mount，pos 保证从
 *  null 起步，防闪烁才真正生效。 */
function ModeMenu({
  anchor,
  btnRef,
  viewMode,
  setViewMode,
  onClose
}: {
  anchor: { x: number; y: number }
  btnRef: React.RefObject<HTMLButtonElement>
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  onClose: () => void
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const pos = useMenuAnchor(anchor.x, anchor.y, menuRef)

  // 点外面关掉。菜单 portal 到 body，DOM 上不再是按钮的子节点，所以触发按钮要
  // 单独放行——按钮本身是常驻可点的开关（不是右键菜单那种一次性触发源），这里
  // 如果不排除它，点按钮时会先被这个 mousedown 监听关一次、按钮自己的 onClick
  // 再开一次，表现成"关不掉"。这跟画布那套 useDismiss（不分触发源，逮着
  // mousedown 就关）不适用于这里是同一个原因：useDismiss 假设菜单外没有常驻的
  // 触发元素需要继续接收点击，ModeSwitch 的触发按钮恰恰是常驻的，所以没有直接
  // 复用 useDismiss，沿用了已验证过的 btnRef/menuRef 分开判。
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [btnRef, onClose])

  return createPortal(
    <div
      className="mode-menu"
      ref={menuRef}
      style={{ left: pos?.x ?? anchor.x, top: pos?.y ?? anchor.y, visibility: pos ? 'visible' : 'hidden' }}
    >
      {MODES.map((m) => (
        <button
          key={m.key}
          className={`mode-menu-item${m.key === viewMode ? ' on' : ''}`}
          onClick={() => {
            setViewMode(m.key)
            onClose()
          }}
        >
          <m.Icon size={13} />
          {m.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

export function ModeSwitch(): JSX.Element {
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const cur = MODES.find((m) => m.key === viewMode) ?? MODES[0]

  return (
    <div className="mode-switch-wrap">
      <button
        ref={btnRef}
        className={`mode-switch${open ? ' on' : ''}`}
        onClick={() => {
          // .titlebar 是 overflow:hidden，挂在它下面的绝对定位下拉会被裁掉——
          // 点上去只会点穿到裁剪区域后面的终端（同一个坑 McpIndicator 已经踩过，
          // 见那个文件顶部注释）。所以菜单走 portal 到 body、锚点坐标在这里现算，
          // 具体的夹回可视区交给 ModeMenu 里的 useMenuAnchor。
          const r = btnRef.current!.getBoundingClientRect()
          setAnchor({ x: r.left, y: r.bottom + 6 })
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
      {open && (
        <ModeMenu
          anchor={anchor}
          btnRef={btnRef}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
