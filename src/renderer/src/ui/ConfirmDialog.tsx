import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'

export function ConfirmDialog(): JSX.Element | null {
  const pending = useStore((s) => s.pendingConfirm)
  const cancel = useStore((s) => s.cancelConfirm)

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        pending.onConfirm()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [pending, cancel])

  if (!pending) return null

  return createPortal(
    <div className="confirm-overlay" onMouseDown={cancel}>
      <div className="confirm-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-message">{pending.message}</div>
        <div className="confirm-actions">
          <button className="ghost-btn" onClick={cancel}>
            取消
          </button>
          <button
            className="danger-btn"
            autoFocus
            onClick={() => {
              pending.onConfirm()
              cancel()
            }}
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
