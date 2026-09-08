import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { activeQuestion, questionEntries, railPlacement, QUESTION_SCROLL_INSET } from './questionIndex'
import type { Turn } from './reduce'
import './questionNavigator.css'

export function QuestionNavigator({ turns, scrollRef, leafId, onNavigate }: {
  turns: Turn[]; scrollRef: RefObject<HTMLDivElement>; leafId?: string; onNavigate: () => void
}): JSX.Element | null {
  // The reducer mutates turns in place. Recompute on every render, never memo by its reference.
  const entries = questionEntries(turns)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const [active, setActive] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [placement, setPlacement] = useState<(NonNullable<ReturnType<typeof railPlacement>> & { zIndex: number }) | null>(null)
  const railRef = useRef<HTMLElement>(null)
  const [previewTop, setPreviewTop] = useState(0)

  useEffect(() => {
    const root = scrollRef.current
    if (!root || !entries.length) return
    let raf = 0
    let last = ''
    const measure = (): void => {
      raf = 0
      const pane = root.closest<HTMLElement>('.pane')
      const drawer = document.querySelector<HTMLElement>('.canvas-drawer')
      const r = root.getBoundingClientRect()
      const layer = pane?.closest<HTMLElement>('.pane-layer')?.getBoundingClientRect()
      const clipped = { left: Math.max(r.left, layer?.left ?? 0), right: Math.min(r.right, layer?.right ?? innerWidth), top: Math.max(r.top, layer?.top ?? 0), bottom: Math.min(r.bottom, layer?.bottom ?? innerHeight) }
      // PaneView owns selection: .sel in canvas, .active in split mode.
      if (!pane || !pane.matches('.sel, .active') || getComputedStyle(pane).display === 'none' || clipped.right - clipped.left < 80 || clipped.bottom - clipped.top < 100) {
        if (last !== 'hidden') { last = 'hidden'; setPlacement(null); setHover(null) }
        delete root.dataset.questionRail
        if (pane && getComputedStyle(pane).display !== 'none' && pane.getAnimations().some(animation => animation.playState === 'running')) raf = requestAnimationFrame(measure)
        return
      }
      const paneRect = pane.getBoundingClientRect()
      // The rail belongs to this chat module: 26px rail + 12px screen-space gap.
      // A frame can contain independently positioned modules; its bounds are not an anchor.
      const left = paneRect.left
      let outside = true
      if (left - 38 < (layer?.left ?? 0)) outside = false
      const candidate = railPlacement({ ...clipped, left }, innerWidth, innerHeight, outside)
      if (candidate?.outside) {
        const hit = document.elementsFromPoint(candidate.left + 12, candidate.top + candidate.height / 2).find(el => !railRef.current?.contains(el))
        if (hit?.closest('.pane, .canvas-drawer, .sidebar, .ac-question-nav')) outside = false
      }
      let next = railPlacement({ ...clipped, left: outside ? left : clipped.left }, innerWidth, innerHeight, outside)
      // An open resource drawer can cover both the outside and inside positions.
      // Let the drawer own that region instead of putting chat ticks over its files.
      const dr = drawer?.getBoundingClientRect()
      if (next && dr && dr.right > next.left && dr.left < next.left + 26 && dr.bottom > next.top && dr.top < next.top + next.height) { next = null; setHover(null) }
      // Resource drawers are at 45. Only a maximized pane (200), which hides
      // those drawers, needs the raised rail. Normal canvas/split stays below them.
      const positioned = next && { ...next, zIndex: getComputedStyle(pane).zIndex === '200' ? 220 : 40 }
      const signature = JSON.stringify(positioned)
      if (signature !== last) { last = signature; setPlacement(positioned) }
      if (next) root.dataset.questionRail = next.outside ? 'outside' : 'inside'
      else delete root.dataset.questionRail
      const tops = Array.from(root.querySelectorAll<HTMLElement>('[data-question-index]')).map(el => (el.getBoundingClientRect().top - r.top) / (r.height / root.clientHeight || 1) + root.scrollTop)
      setActive(activeQuestion(tops, root.scrollTop))
      // PaneView uses a short FLIP transform on maximize/restore. Layout observers see
      // its final box only; sample the animation until its last frame, then go idle.
      if ([...pane.getAnimations(), ...(drawer?.getAnimations() ?? [])].some(animation => animation.playState === 'running')) raf = requestAnimationFrame(measure)
    }
    // Invalidate on real geometry/content changes, never poll retained chat panes at idle.
    const schedule = (): void => { if (!raf) raf = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    const mutations = new MutationObserver(schedule)
    mutations.observe(root, { subtree: true, childList: true, characterData: true })
    const pane = root.closest<HTMLElement>('.pane')
    if (pane) mutations.observe(pane, { attributes: true, attributeFilter: ['class'] })
    const unsubscribe = useStore.subscribe(schedule)
    measure()
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    return () => { cancelAnimationFrame(raf); resize.disconnect(); mutations.disconnect(); unsubscribe(); window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true); delete root.dataset.questionRail }
  }, [scrollRef, leafId, entries.length])

  const jump = (index: number): void => {
    const root = scrollRef.current
    const entry = entriesRef.current[index]
    const target = root?.querySelector<HTMLElement>('[data-question-index="' + entry?.turnIndex + '"]')
    if (!root || !target) return
    onNavigate()
    const r = root.getBoundingClientRect()
    const scale = r.height / root.clientHeight || 1
    root.scrollTo({ top: root.scrollTop + (target.getBoundingClientRect().top - r.top) / scale - QUESTION_SCROLL_INSET, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setActive(index)
    setHover(null)
  }
  if (!placement || !entries.length) return null
  const preview = hover === null ? null : entries[hover]
  const previewWidth = Math.min(320, innerWidth - placement.left - 48)
  return createPortal(<nav ref={railRef} className={'ac-question-nav' + (placement.outside ? ' outside' : ' inside')}
    data-leaf={leafId} aria-label="当前对话提问导航"
    style={{ left: placement.left, top: placement.top, height: placement.height, zIndex: placement.zIndex }}
    onMouseLeave={() => setHover(null)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(null) }}>
    <div className="ac-question-ticks">
      {entries.map((entry, index) => <button key={entry.turnIndex} type="button" aria-label={'定位第 ' + (index + 1) + ' 条提问：' + entry.title}
        aria-current={active === index ? 'location' : undefined}
        onFocus={e => { setHover(index); setPreviewTop(e.currentTarget.getBoundingClientRect().top) }}
        onMouseEnter={e => { setHover(index); setPreviewTop(e.currentTarget.getBoundingClientRect().top) }}
        onClick={() => jump(index)}><span /></button>)}
    </div>
    {preview && <button type="button" className="ac-question-preview" onClick={() => jump(hover!)}
      style={{ left: placement.left + 24, top: Math.max(12, Math.min(innerHeight - 190, previewTop - 26)), width: previewWidth }}>
      <strong>{preview.title}</strong><span>{preview.preview || '尚无文字回复'}</span>
    </button>}
  </nav>, document.body)
}
