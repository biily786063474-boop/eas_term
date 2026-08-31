// 甘特图轨道右键菜单：终端/画布/看板三选一，选中即按该模式跳到这条任务对应的
// 终端，并记为下次左键点条的默认模式（GanttStage.tsx 的 jump() 读这份记忆，
// 存在 store 的 ganttJumpMode，见 uiSlice.ts）。
//
// 独立子组件、只在打开时挂载——同 ModeSwitch.tsx 的 ModeMenu 是同一个理由：
// useMenuAnchor「hidden 直到测量完再显示」的防闪烁要生效，前提是每次打开 pos
// 状态都从 null 起步。GanttStage.tsx 那边额外给它加了 key={task.id}：右键 A
// 的菜单开着时不经过"先关掉"直接右键 B，这种连续切换本来不会触发重新挂载
// （同一个组件类型、同一个位置，React 只会传新 props），key 变了才会强制卸载
// 重装，保证不会沿用上一条任务量出来的旧坐标。
//
// 没有直接复用 CanvasContextMenu（那个通用组件）：它的 .canvas-ctxmenu 定死
// z-index:1000，比这张图自己的 hover 浮层 .gantt-pop（gantt.css，3400）还低——
// 右键时浮层可能还开着，用那个组件会被悬浮卡整个盖住点不到。改浮层的
// z-index 又是牵一发动全身的全局改动（base.css 顶上有全局 z-index 分配的
// 大注释，.canvas-ctxmenu 同时被 Sidebar/CanvasDrawer/FileTree/HistoryView/
// TerminalInput/CanvasStage 六处复用，谁都不该单独改这一个数字）。所以这里
// 照 ModeMenu 的先例：只拿 useMenuAnchor/useDismiss 这两个纯定位/纯关闭逻辑，
// 视觉自己另起一套 class（.gantt-ctxmenu/.gctx-item，gantt.css），z-index
// 按这张图自己的层级走。
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { TerminalIcon, CanvasIcon, BoardIcon } from '../../ui/Icons'
import { useMenuAnchor, useDismiss } from '../../ui/CanvasContextMenu'
import type { GanttJumpMode } from '../../store/uiSlice'

const MODES: { key: GanttJumpMode; label: string; Icon: typeof BoardIcon }[] = [
  { key: 'split', label: '分屏', Icon: TerminalIcon },
  { key: 'canvas', label: '画布', Icon: CanvasIcon },
  { key: 'board', label: '看板', Icon: BoardIcon }
]

export function GanttJumpMenu({
  x,
  y,
  alive,
  hasCanvasNode,
  current,
  onPick,
  onClose
}: {
  x: number
  y: number
  /** 这条任务对应的终端是否还活着——false 时三个模式全没意义，菜单换成单行
   *  说明（同 CanvasStage.tsx「这个 Frame 没有绑定文件夹」的先例：单行禁用项
   *  说明原因，不是把正常菜单的三个选项逐个灰掉——那样会让人以为换一个还有救,
   *  实际是这条终端本身已经不在了，跟选哪个模式无关）。 */
  alive: boolean
  /** 这个终端有没有对应的画布节点——只影响"画布"这一项能不能选，终端/看板
   *  不受影响（分屏只要 tab 还在就能切过去，看板全屏找不到会被 BoardStage
   *  自己的自愈 effect 弹回总览，两者都不依赖画布上有没有摆过这个节点）。 */
  hasCanvasNode: boolean
  /** 当前记住的默认模式，高亮标出来，帮用户理解"不换的话左键点条会去哪"。 */
  current: GanttJumpMode
  onPick: (mode: GanttJumpMode) => void
  onClose: () => void
}): JSX.Element {
  useDismiss(onClose)
  const ref = useRef<HTMLDivElement>(null)
  const pos = useMenuAnchor(x, y, ref)

  return createPortal(
    <div
      ref={ref}
      className="gantt-ctxmenu"
      style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!alive ? (
        <div className="gctx-item info">这个终端已经关闭，无法跳转</div>
      ) : (
        MODES.map((m) => {
          const disabled = m.key === 'canvas' && !hasCanvasNode
          return (
            <button
              key={m.key}
              className={`gctx-item${m.key === current ? ' on' : ''}`}
              disabled={disabled}
              onClick={() => {
                onPick(m.key)
                onClose()
              }}
            >
              <m.Icon size={13} />
              <span className="gctx-label">{m.label}</span>
              {disabled && <span className="gctx-hint">不在画布上</span>}
            </button>
          )
        })
      )}
    </div>,
    document.body
  )
}
