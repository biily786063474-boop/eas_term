// 画布右键菜单：统一 CRUD 入口。菜单项由 CanvasStage 按右键目标（节点/Frame/图形/空白）构造。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface CanvasMenuItem {
  label: string
  danger?: boolean
  kbd?: string
  /** 右侧灰字补充说明（如「当前」） */
  hint?: string
  /** 右侧的状态 icon。和 hint 二选一——两个都给时 icon 优先。 */
  icon?: JSX.Element
  /** 分隔线：忽略其余字段 */
  sep?: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * 把浮层夹回可视区：靠窗口右/下缘弹出时不被裁掉。
 * 实测尺寸而非估算——菜单项数不定，估出来的高度对不上。
 *
 * **尺寸要持续跟，不能只量一次。** 浮层的内容常常是异步来的：文件选择器要等 IPC
 * 读完目录才知道自己多高，只在挂载时量一次的话，量到的是「空列表」那一瞬的小尺寸，
 * 等文件填进来面板长高，位置却还停在按小尺寸算的地方，底部就捅出窗口了
 * （Frame 内双击出的插入文件选择器实测如此）。所以挂一个 ResizeObserver，
 * 尺寸一变就重新夹一次。改的是 left/top，不影响自身尺寸，不会自激。
 */
export function useMenuAnchor(
  x: number,
  y: number,
  ref: React.RefObject<HTMLElement>,
  deps: unknown[] = []
): { x: number; y: number } | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const place = (): void => {
      const w = el?.offsetWidth ?? 190
      const h = el?.offsetHeight ?? 200
      setPos({
        x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - h - 8))
      })
    }
    place()
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps])
  return pos
}

/** 点浮层外 / 窗口失焦 / Esc → 关闭 */
export function useDismiss(onClose: () => void): void {
  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
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
  useDismiss(onClose)
  const ref = useRef<HTMLDivElement>(null)
  const pos = useMenuAnchor(x, y, ref, [items.length])

  return createPortal(
    <div
      ref={ref}
      className="canvas-ctxmenu"
      style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="cctx-sep" />
        ) : (
          <button
            key={i}
            className={`cctx-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            <span className="cctx-label">{it.label}</span>
            {it.kbd && <span className="cctx-kbd">{it.kbd}</span>}
            {it.icon ?? (it.hint ? <span className="cctx-hint">{it.hint}</span> : null)}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
