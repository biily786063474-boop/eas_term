// 右上角气泡点开的已完成列表。**只列 done**——approval 那类要去灵动岛或终端处理，
// 混进来会让这个列表变成「所有待办」，失去「哪些跑完了可以验收」这个明确用途。
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { StatusIcon } from './StatusIcon'
import { focusTerminal, useDoneRows } from './useStatus.ts'

export function DoneList({ onClose }: { onClose: () => void }): JSX.Element | null {
  const rows = useDoneRows()
  const boxRef = useRef<HTMLDivElement>(null)

  // 点外面关掉。用 mousedown 而不是 click：click 要等 mouseup，
  // 期间用户可能已经在拖别的东西了
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

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
