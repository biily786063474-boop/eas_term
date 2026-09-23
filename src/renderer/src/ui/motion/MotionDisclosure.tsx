import { useEffect, useReducer, useRef, useLayoutEffect, type ReactNode } from 'react'
import { nextDisclosurePresence } from './disclosurePresence.ts'
import './disclosure.css'

const DURATION_MS = 180

/** Animates both directions, then unmounts closed content (important for long tool output).
 *  Parent must move focus back to its trigger before closing if focus is inside. */
export function MotionDisclosure({ open, id, className = '', children }: {
  open: boolean; id: string; className?: string; children: ReactNode | (() => ReactNode)
}): JSX.Element | null {
  const [state, dispatch] = useReducer(nextDisclosurePresence, { present: open, active: open })
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (rootRef.current) rootRef.current.inert = !open }, [open, state.present])
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (open) {
      dispatch('open')
      if (reduced) { dispatch('entered'); return }
      let second = 0
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => dispatch('entered')) })
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    }
    dispatch('close')
    const timer = window.setTimeout(() => dispatch('exited'), reduced ? 0 : DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!state.present) return null
  return <div ref={rootRef} id={id} className={`motion-disclosure ${className}`} data-open={state.active ? 'true' : 'false'}
    aria-hidden={!open}>
    <div className="motion-disclosure-inner">{typeof children === 'function' ? children() : children}</div>
  </div>
}
