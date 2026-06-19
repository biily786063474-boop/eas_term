import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { THEMES } from '../themes'
import { PaletteIcon, CheckIcon } from './Icons'

export function ThemeSelect(): JSX.Element {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (e.target instanceof Node && btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        className="icon-btn"
        title="主题"
        onClick={() => {
          const r = btnRef.current!.getBoundingClientRect()
          setPos({ x: r.right - 170, y: r.bottom + 6 })
          setOpen((v) => !v)
        }}
      >
        <PaletteIcon size={14} />
      </button>
      {open &&
        createPortal(
          <div className="glass-menu" style={{ left: pos.x, top: pos.y }}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`glass-menu-item${t.id === theme ? ' selected' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setOpen(false)
                  setTheme(t.id)
                }}
              >
                <span className="theme-swatch" style={{ background: t.swatch }} />
                <span>{t.label}</span>
                {t.id === theme && <CheckIcon size={12} className="glass-menu-check" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
