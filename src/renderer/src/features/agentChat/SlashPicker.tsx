// Both composers share this controller. Only the focused textarea owns its portal.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useId, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { DictChip } from './chips'
import type { ComposerInputElement } from './ComposerInput'
import { referenceFromCandidate, type ComposerReference } from './composerReferences'
import { categoryLabel, commandCandidates, dictCandidates, filterCandidates, insertCandidate, popupPosition, triggerAt, type Candidate, type Category, type DictEntry } from './composerCandidates'
import { useT } from '../../i18n.ts'
import { browserCandidates, loadDictionary, loadUserDictionary, loadFiles, loadPlugins, loadSkills } from './composerSources'

interface PickerOptions { boundPluginId?: string; nativeSlash?: {name:string;description:string}[]; cli?: string; onAddChip?: (c: DictChip) => void; model?: boolean; effort?: boolean; compact?: () => void }
type Source = 'dict' | 'userDict' | 'files' | 'skills' | 'plugins'
type SourceState = { status: 'loading' | 'ready' | 'error'; rows: Candidate[]; terms?: DictEntry[] }
export function useSlashPicker(text: string, setText: (v: string) => void, onPicked?: () => void, cwd?: string, anchorRef?: RefObject<HTMLTextAreaElement | ComposerInputElement | null>, chips: readonly DictChip[] = [], options: PickerOptions = {}) {
  const t = useT()
  const [pickedReferences, setPickedReferences] = useState<ComposerReference[]>([])
  useEffect(() => setPickedReferences([]), [cwd, options.cli, options.boundPluginId])
  const references = useMemo(() => [...pickedReferences.filter(r => r.kind !== 'dict'), ...chips.map(c => referenceFromCandidate({id:c.id,category:'dict',name:c.label,description:t('chat.slash.dictPrompt'),insert:'@'+c.label,chip:c}))], [pickedReferences, chips, t])
  const [selection, setSelection] = useState<[number, number]>([text.length, text.length])
  const [focused, setFocused] = useState(false)
  const [off, setOff] = useState(false)
  const [category, setCategory] = useState<Category>('all')
  const [idx, setIdx] = useState(0)
  const [retry, setRetry] = useState(0)
  const [sources, setSources] = useState<Partial<Record<Source, SourceState>>>({})
  const [browsers, setBrowsers] = useState<Candidate[]>([])
  const focusFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), [])
  const deferFocus = (fn: () => void): void => {
    cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(fn)
  }
  const id = useId()
  const trigger = triggerAt(text, ...selection)
  const mode = trigger?.mode
  const active = focused && !off && !!trigger
  const syncSelection = (): void => {
    const el = anchorRef?.current
    if (el) { setSelection([el.selectionStart, el.selectionEnd]); setFocused(document.activeElement === el) }
  }
  useLayoutEffect(syncSelection, [text, anchorRef])
  useEffect(() => { setOff(false); setIdx(0) }, [text, selection[0], selection[1]])
  useEffect(() => { setCategory('all'); setIdx(0) }, [mode, options.cli, cwd])
  useEffect(() => {
    if (!active) return
    let alive = true
    setSources({})
    setBrowsers(browserCandidates())
    const load = (key: Source, run: () => Promise<Candidate[] | DictEntry[]>): void => {
      setSources(s => ({ ...s, [key]: { status: 'loading', rows: [] } }))
      void run().then(rows => {
        if (alive) setSources(s => ({ ...s, [key]: key === 'dict' || key === 'userDict' ? { status: 'ready', rows: [], terms: rows as DictEntry[] } : { status: 'ready', rows: rows as Candidate[] } }))
      }).catch(() => { if (alive) setSources(s => ({ ...s, [key]: { status: 'error', rows: [] } })) })
    }
    load('skills', () => loadSkills({ cli: options.cli, mode, cwd }))
    if (mode === '@') { load('dict', loadDictionary); load('userDict', loadUserDictionary); load('files', () => loadFiles(cwd ?? '')); load('plugins', () => loadPlugins(options.cli ?? '', options.boundPluginId)) }
    return () => { alive = false }
  }, [active, mode, cwd, options.cli, options.boundPluginId, retry])
  const commands = useMemo(() => commandCandidates({ model: !!options.model, effort: !!options.effort, compact: !!options.compact }), [options.model, options.effort, !!options.compact])
  const pool = useMemo(() => mode === '/' ? [...commands, ...(options.nativeSlash ?? []).map(c => ({id:'native:'+c.name, category:'native' as const, name:c.name, description:c.description, insert:'/'+c.name})), ...(sources.skills?.rows ?? [])] : [...dictCandidates(chips, [...(sources.dict?.terms ?? []), ...(sources.userDict?.terms ?? [])]), ...(sources.files?.rows ?? []), ...(sources.skills?.rows ?? []), ...(sources.plugins?.rows ?? []), ...browsers], [mode, commands, sources, chips, browsers, options.nativeSlash])
  const matched = useMemo(() => filterCandidates(pool, trigger?.query ?? '', category), [pool, trigger?.query, category])
  const hits = matched.slice(0, 200)
  const safeIdx = Math.min(idx, Math.max(0, hits.length - 1))
  const categories: Category[] = mode === '/' ? ['all', 'common', ...(options.nativeSlash?.length ? ['native' as const] : []), 'skill'] : ['all', 'dict', 'file', 'folder', 'skill', 'plugin', 'app', 'browser']
  const relevant: Source[] = category === 'dict' ? ['dict', 'userDict'] : category === 'file' || category === 'folder' ? ['files'] : category === 'skill' ? ['skills'] : category === 'plugin' || category === 'app' ? ['plugins'] : category === 'browser' || category === 'common' || category === 'native' ? [] : mode === '/' ? ['skills'] : ['dict', 'userDict', 'files', 'skills', 'plugins']
  const loading = relevant.some(k => sources[k]?.status === 'loading')
  const errors = relevant.filter(k => sources[k]?.status === 'error')
  const insert = (c: Candidate | undefined): void => {
    if (!trigger || !c || c.disabled) return
    if (c.chip) options.onAddChip?.(c.chip)
    if (c.category !== 'common' && c.category !== 'native') setPickedReferences(cur => [...cur.filter(r => r.id !== c.id), referenceFromCandidate(c)])
    const next = insertCandidate(text, trigger, c)
    setText(next.text); setOff(true); onPicked?.()
    deferFocus(() => { anchorRef?.current?.focus(); anchorRef?.current?.setSelectionRange(next.caret, next.caret) })
  }
  const activate = (marker: '@' | '/'): void => {
    const el = anchorRef?.current
    const start = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? start
    if (marker === '/' && text.trim()) { el?.focus(); return }
    const lead = marker === '@' && start > 0 && !/[\s（(，,。:：]/.test(text[start - 1]) ? ' ' : ''
    setText(text.slice(0, start) + lead + marker + text.slice(end)); setOff(false); setFocused(true)
    const caret = start + lead.length + 1
    deferFocus(() => { el?.focus(); el?.setSelectionRange(caret, caret); setSelection([caret, caret]) })
  }
  // Selection only fills. An explicit send invokes the existing control without a model call.
  const consumeCommand = (): boolean => {
    const match = /^\/(mention|model|effort|compact)\s*$/.exec(text)
    if (!match || !commands.some(c => c.name === match[1])) return false
    cancelAnimationFrame(focusFrame.current)
    const cmd = match[1]
    if (cmd === 'mention') {
      setText('@')
      deferFocus(() => { anchorRef?.current?.focus(); anchorRef?.current?.setSelectionRange(1, 1); setSelection([1, 1]); setOff(false) })
      return true
    }
    const root = anchorRef?.current?.closest('.ac-input-wrap, .ac-composer-box') ?? anchorRef?.current?.parentElement
    const labels = cmd === 'model' ? [t('chat.startupModel.ariaModel'), t('chat.slash.chatModelAria')] : [t('chat.slash.startupEffortAria'), t('chat.effort.aria')]
    if (cmd === 'compact') options.compact?.()
    else {
      const control = labels.map(label => root?.querySelector<HTMLElement>('[aria-label="' + label + '"]')).find(Boolean)
      if (!control) { root?.dispatchEvent(new Event('composer-settings-open')); setText(''); return true }
      control.focus()
    }
    setText(''); return true
  }
  const handleKey = (e: KeyboardEvent): boolean => {
    if (!active || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOff(true); return true }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIdx(hits.length ? (safeIdx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length : 0); return true }
    if ((e.key === 'Enter' || e.key === 'Tab') && hits.length) { e.preventDefault(); insert(hits[safeIdx]); return true }
    return false
  }
  const inputProps = { 'aria-expanded': active, 'aria-controls': active ? id : undefined, 'aria-activedescendant': active && hits.length ? id + '-' + safeIdx : undefined, 'aria-autocomplete': 'list' as const, onSelect: syncSelection, onBlur: () => setFocused(false), onClick: syncSelection, onKeyUp: syncSelection }
  return { references, open: active, total: matched.length, hits, idx: safeIdx, setIdx, pick: (i: number) => insert(hits[i]), anchorRef, handleKey, category, setCategory: (c: Category) => { setCategory(c); setIdx(0) }, categories, mode, loading, errors, retry: () => setRetry(n => n + 1), close: () => setOff(true), id, inputProps, activate, consumeCommand, syncSelection }
}
export type SlashPickerState = ReturnType<typeof useSlashPicker>
export function SlashList(s: SlashPickerState): JSX.Element | null {
  const t = useT()
  const [present, setPresent] = useState(s.open)
  const [shown, setShown] = useState(false)
  const previous = useRef(s)
  if (s.open) previous.current = s
  const display = s.open ? s : previous.current
  const popupRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (s.open) { setPresent(true); const f = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(f) }
    setShown(false); const t = setTimeout(() => setPresent(false), 180); return () => clearTimeout(t)
  }, [s.open])
  useLayoutEffect(() => { if (popupRef.current) popupRef.current.inert = !s.open }, [s.open, present])
  const [pos, setPos] = useState<ReturnType<typeof popupPosition>>(null)
  const [detail, setDetail] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => setDetail(false), [s.category, s.idx])
  useLayoutEffect(() => {
    if (!s.open) return
    let frame = 0, last = ''
    const update = (): void => {
      const el = s.anchorRef?.current
      const next = el && document.activeElement === el ? popupPosition((el.closest('.cm-scroller') ?? el).getBoundingClientRect(), innerWidth, innerHeight) : null
      const key = JSON.stringify(next)
      if (key !== last) { last = key; setPos(next) }
      frame = requestAnimationFrame(update)
    }
    update(); return () => cancelAnimationFrame(frame)
  }, [s.anchorRef, s.open])
  useLayoutEffect(() => { listRef.current?.querySelector('[data-index="' + s.idx + '"]')?.scrollIntoView({ block: 'nearest' }) }, [s.idx])
  if (!present || !pos) return null
  const selected = display.hits[display.idx]
  return createPortal(<div ref={popupRef} className="ac-mentions ac-mentions-motion" data-open={shown && s.open} aria-hidden={!s.open} style={{ ...pos, position: 'fixed' }} onMouseDown={e => e.preventDefault()}>
    <div className="ac-mentions-head"><strong>{display.mode === '@' ? t('chat.slash.headMention') : t('chat.slash.headCommand')}</strong><button type="button" aria-label={t('chat.slash.closeAria')} onClick={s.close}>×</button></div>
    <div className="ac-mentions-body"><nav aria-label={t('chat.slash.catAria')}>{display.categories.map(c => <button type="button" key={c} aria-pressed={display.category === c} onClick={() => s.setCategory(c)}>{categoryLabel(c)}</button>)}</nav>
      <div className="ac-mentions-results" ref={listRef}>
        {(display.loading || display.errors.length > 0) && <div className="ac-mentions-status" role="status">
          <span>{display.errors.length ? t('chat.slash.srcFailed', { list: display.errors.map(k => t(({dict:'chat.slash.srcDict',userDict:'chat.slash.srcUserDict',files:'chat.slash.srcFiles',skills:'chat.slash.srcSkills',plugins:'chat.slash.srcPlugins'} as const)[k])).join(t('chat.slash.listSep')) }) : t('chat.slash.loading')}{display.errors.length > 0 && display.loading ? t('chat.slash.partialLoading') : ''}</span>
          {display.errors.length > 0 && <button type="button" onClick={s.retry}>{t('chat.slash.retry')}</button>}
        </div>}
        {!display.loading && !display.hits.length && <div className="ac-mentions-empty">{t('chat.slash.noMatch')}<small>{display.category === 'browser' ? t('chat.slash.hintBrowser') : display.category === 'file' || display.category === 'folder' ? t('chat.slash.hintFiles') : t('chat.slash.hintTry')}</small></div>}
        <div role="listbox" id={display.id} aria-label={t('chat.slash.listAria')}>{display.hits.map((c, i) => <div key={c.id}>
          {c.category === 'dict' && (i === 0 || display.hits[i - 1].preloaded !== c.preloaded) && <div className="ac-mentions-group">{c.preloaded ? t('chat.slash.groupPreloaded') : t('chat.slash.groupAll')}</div>}
          <div role="option" id={display.id + '-' + i} data-index={i} aria-selected={display.idx === i} aria-disabled={!!c.disabled} className={'ac-mentions-row' + (display.idx === i ? ' on' : '')} onMouseEnter={() => s.setIdx(i)} onClick={() => s.pick(i)} title={c.disabled || c.description}>
            <span className="ac-mentions-glyph">{c.category === 'dict' ? '▤' : c.category === 'common' ? '/' : c.category === 'skill' ? '✧' : '@'}</span><span className="ac-mentions-copy"><strong>{c.name}</strong><small>{c.disabled ? t(c.disabled as Parameters<typeof t>[0]) : c.description}</small></span><span className="ac-mentions-kind">{c.preloaded ? t('chat.slash.badgeAlt') : categoryLabel(c.category)}</span>
          </div>
        </div>)}</div>
      </div>
    </div>
    {detail && selected?.chip && <div className="ac-mentions-detail"><strong>{selected.name}</strong><p>{selected.chip.text}</p><button type="button" onClick={() => s.pick(display.idx)}>{t('chat.slash.insertRef')}</button></div>}
    <div className="ac-mentions-foot"><span>{t('chat.slash.footKeys')}</span>{selected?.chip && <button type="button" onClick={() => setDetail(v => !v)}>{detail ? t('chat.slash.hidePreview') : t('chat.slash.showPreview')}</button>}<span>{display.total > 200 ? t('chat.slash.top200') : t('chat.slash.total', { n: display.total })}</span></div>
  </div>, document.body)
}
