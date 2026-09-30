import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { popupPosition } from './composerCandidates'
import { referenceLabel, type ComposerReference } from './composerReferences'
import { useT } from '../../i18n.ts'

function Preview({ reference: r, anchor, keepOpen, close }: { reference: ComposerReference; anchor: HTMLElement; keepOpen: () => void; close: () => void }): JSX.Element | null {
  const t = useT()
  const [position, setPosition] = useState<ReturnType<typeof popupPosition>>(null)
  const [image, setImage] = useState(r.imageUrl)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setImage(r.imageUrl); setError('')
    if (r.imagePath) void window.api.fs.readImageFile(r.imagePath).then(result => {
      if (!alive) return
      if (result.ok) setImage(result.dataUrl)
      else setError(result.error || t('chat.ref.imageNoPreview'))
    }).catch(() => { if (alive) setError(t('chat.ref.imageNoPreview')) })
    return () => { alive = false }
  }, [r.imagePath, r.imageUrl])
  useLayoutEffect(() => {
    let frame = 0, last = ''
    const update = (): void => {
      const next = anchor.isConnected ? popupPosition(anchor.getBoundingClientRect(), innerWidth, innerHeight) : null
      const key = JSON.stringify(next)
      if (key !== last) { last = key; setPosition(next) }
      frame = requestAnimationFrame(update)
    }
    update(); return () => cancelAnimationFrame(frame)
  }, [anchor])
  if (!position) return null
  return createPortal(<div className="ac-reference-preview" data-kind={r.kind} style={position} role="tooltip" onMouseEnter={keepOpen} onMouseLeave={close}>
    <header><span>{referenceLabel(r.kind)}</span><strong>{r.label}</strong></header>
    {r.detail && <p>{r.detail}</p>}
    {(r.kind === 'plugin' || r.kind === 'app') && <p className="ac-reference-note">{t('chat.ref.boundNote')}</p>}
    {r.kind === 'image' && (image ? <img src={image} alt={r.label} /> : <p>{error || t('chat.ref.readingImage')}</p>)}
    {image && error && <p>{error}</p>}
    <small>{r.kind === 'dict' ? t('chat.ref.expandsTo') : t('chat.ref.sentContent')}</small><pre>{r.payload}</pre>
  </div>, document.body)
}
export function useReferenceHover() {
  const [hover, setHover] = useState<{ reference: ComposerReference; anchor: HTMLElement } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const keepOpen = (): void => clearTimeout(timer.current)
  const close = (): void => { keepOpen(); timer.current = setTimeout(() => setHover(null), 180) }
  const show = (reference: ComposerReference, anchor: HTMLElement): void => { keepOpen(); setHover(current => current?.anchor === anchor && current.reference === reference ? current : { reference, anchor }) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!hover) return
    const escape = (e: KeyboardEvent): void => { if (e.key === 'Escape') setHover(null) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [!!hover])
  return { show, close, keepOpen, preview: hover && <Preview {...hover} keepOpen={keepOpen} close={close} /> }
}
export function ReferenceHover({ reference, children }: { reference: ComposerReference; children: ReactNode }): JSX.Element {
  const hover = useReferenceHover()
  return <span className="ac-reference-hover" tabIndex={0} onMouseEnter={e => hover.show(reference, e.currentTarget)} onMouseLeave={hover.close} onFocus={e => hover.show(reference, e.currentTarget)} onBlur={hover.close}>{children}{hover.preview}</span>
}
