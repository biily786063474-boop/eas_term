// 画布右键菜单：统一 CRUD 入口。菜单项由 CanvasStage 按右键目标（节点/Frame/图形/空白）构造。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

  // 实测菜单尺寸后夹回可视区：靠窗口右/下缘右键时不会被裁掉（估算尺寸对不定项数的菜单不准）
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const w = el?.offsetWidth ?? 190
    const h = el?.offsetHeight ?? 40 + items.length * 32
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - h - 8))
    })
  }, [x, y, items.length])

  return createPortal(
    <div
      ref={ref}
      className="canvas-ctxmenu"
      style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
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
