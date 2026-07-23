// 画布右键菜单：统一 CRUD 入口。菜单项由 CanvasStage 按右键目标（节点/Frame/图形/空白）构造。
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface CanvasMenuItem {
  label: string
  danger?: boolean
  kbd?: string
  onClick: () => void
}

export function CanvasContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: CanvasMenuItem[]
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return createPortal(
    <div
      className="canvas-ctxmenu"
      style={{ left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 40 - items.length * 32) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          className={`cctx-item${it.danger ? ' danger' : ''}`}
          onClick={() => {
            it.onClick()
            onClose()
          }}
        >
          <span>{it.label}</span>
          {it.kbd && <span className="cctx-kbd">{it.kbd}</span>}
        </button>
      ))}
    </div>,
    document.body
  )
}
