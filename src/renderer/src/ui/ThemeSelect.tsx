import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { getThemes } from '../themes'
import { PaletteIcon, CheckIcon } from './Icons'
import { useT } from '../i18n.ts'

export function ThemeSelect(): JSX.Element {
  const t = useT()
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
        data-tip={t('dialogs.theme')}
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
            {getThemes().map((th) => (
              <button
                key={th.id}
                className={`glass-menu-item${th.id === theme ? ' selected' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setOpen(false)
                  setTheme(th.id)
                }}
              >
                <span className="theme-swatch" style={{ background: th.swatch }} />
                <span>{th.label}</span>
                {th.id === theme && <CheckIcon size={12} className="glass-menu-check" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
