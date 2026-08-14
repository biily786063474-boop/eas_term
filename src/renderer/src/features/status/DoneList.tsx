// 右上角气泡点开的已完成列表。**只列 done**——approval 那类要去灵动岛或终端处理，
// 混进来会让这个列表变成「所有待办」，失去「哪些跑完了可以验收」这个明确用途。
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { StatusIcon } from './StatusIcon'
import { focusTerminal, useDoneRows } from './useStatus.ts'

export function DoneList({ onClose }: { onClose: () => void }): JSX.Element | null {
  const rows = useDoneRows()
  const boxRef = useRef<HTMLDivElement>(null)
  // onClose 是 CanvasDrawer 每次渲染新建的内联箭头函数，直接放进下面 effect 的依赖数组
  // 会导致列表开着时全局 mousedown 监听器随 CanvasDrawer 的每次重渲染反复移除/重装
  // （CanvasDrawer 订阅的 store 切片不少，重渲染并不罕见）。清理函数写对了、不会丢事件，
  // 纯属可省的开销——用 ref 兜住最新的 onClose，effect 本身只装一次。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // 点外面关掉。用 mousedown 而不是 click：click 要等 mouseup，
  // 期间用户可能已经在拖别的东西了
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return
      onCloseRef.current()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  if (!rows.length) return null

  // portal 到 body：气泡在 .canvas-viewport 里，那是 overflow:clip，
  // 不 portal 出去列表会被切掉（同 ConfirmDialog 的做法）
  return createPortal(
    <div className="st-donelist" ref={boxRef}>
      {rows.map((r) => (
        <button
          key={r.ptyId}
          className="st-done-row"
          onClick={() => {
            focusTerminal(r.ptyId)
            onClose()
          }}
        >
          <StatusIcon state="done" size={13} />
          <span className="st-done-proj">{r.project}</span>
          <span className="st-done-term">{r.term}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}
