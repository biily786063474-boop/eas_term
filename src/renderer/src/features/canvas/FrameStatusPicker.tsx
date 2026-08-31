// Frame 标题栏色点点开的状态色板。
//
// 复用右键菜单那套浮层机制（夹回可视区 + 点外面/Esc 关闭），而不是自己写一遍：
// 画布上的浮层要么全都能被 Esc 关掉，要么一个都别能——半数能关的浮层最难用。
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { FrameStatus } from '../../store'
import { useDismiss, useMenuAnchor } from '../../ui/CanvasContextMenu'


export function FrameStatusPicker({
  x,
  y,
  frameId,
  current,
  onClose
}: {
  x: number
  y: number
  frameId: string
  current: FrameStatus | undefined
  onClose: () => void
}): JSX.Element {
  const setFrameStatus = useStore((s) => s.setFrameStatus)
  // 列是用户自己建的，这里跟着 store 走，不再是写死的三个
  const columns = useStore((s) => s.boardColumns)
  useDismiss(onClose)
  const ref = useRef<HTMLDivElement>(null)
  const pos = useMenuAnchor(x, y, ref)

  const pick = (v: FrameStatus | null): void => {
    setFrameStatus(frameId, v)
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      className="cframe-statuspop"
      style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {columns.map((s) => (
        <button
          key={s.id}
          className={`cfs-item${current === s.id ? ' on' : ''}`}
          style={s.color ? ({ '--dot': s.color } as React.CSSProperties) : undefined}
          // 再点一次当前状态 = 取消它。色板上没有「取消」的单独位置时，
          // 用户的第一反应就是再点一下那个亮着的颜色。
          onClick={() => pick(current === s.id ? null : s.id)}
        >
          <span className="cfs-swatch" />
          <span className="cfs-label">{s.name}</span>
        </button>
      ))}
      <div className="cctx-sep" />
      <button className="cfs-item cfs-clear" disabled={!current} onClick={() => pick(null)}>
        <span className="cfs-swatch" />
        <span className="cfs-label">未分类</span>
      </button>
    </div>,
    document.body
  )
}
