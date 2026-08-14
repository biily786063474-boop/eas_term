// 右上角气泡点开的待处理列表：**等审批的排最前，已完成的在后**。
//
// 原来这里只列 done（那时叫 DoneList），理由是「approval 那类要去灵动岛或终端处理」。
// 那个理由在画布模式下不成立：铃铛不挂载、运行监视只显示 running、灵动岛只在切后台时
// 出现，这个气泡就是 approval 唯一的常驻提示。详见 useStatus.ts 的 PendingRow。
// 排序口径直接取 machine.ts 的 URGENCY（在 computePendingRows 里排好），这里不再排一次。
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { StatusIcon } from './StatusIcon'
import { focusTerminal, usePendingRows } from './useStatus.ts'

export function PendingList({ onClose }: { onClose: () => void }): JSX.Element | null {
  const rows = usePendingRows()
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
    <div className="st-pendlist" ref={boxRef}>
      {rows.map((r) => (
        <button
          key={r.ptyId}
          className="st-pend-row"
          onClick={() => {
            focusTerminal(r.ptyId)
            onClose()
          }}
        >
          {/* icon 形态跟着这一条的实际状态走：approval 是圈+感叹号+呼吸，done 是圈+对勾。
              写死 "done" 的话，等审批那条会顶着一个对勾，正好把最急的那件事说成已经好了 */}
          <StatusIcon state={r.state} size={13} />
          <span className="st-pend-proj">{r.project}</span>
          <span className="st-pend-term">{r.term}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}
