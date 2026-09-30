import { WebView } from '../web/WebView'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import systems from './design-systems.json'
import { designPrompt, findDesignSystems, interfaceTypeIds, interfaceTypeLabel, designTypeLabel, designShortName, designServiceLabel, designNote, localizeDesignCorpus, localizeDesignTitle } from './designSystems'
import { useT, useLang } from '../../i18n.ts'
import type { DesignScope, DesignSystem } from './designSystems'
import './designPicker.css'
import specIndexData from './design-spec-index.json'
const specIndex = specIndexData as Record<string, string>
import previewData from './design-previews.json'
const previews = previewData as Record<string, { cover: string; previewUrl?: string }>
function Sample({ system }: { system: DesignSystem }): JSX.Element {
  const tr = useT()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [system.slug])
  const source = previews[system.slug]
  return source?.cover && !failed
    ? <img className="dsp-cover" src={source.cover} alt={tr('dictUi.ds.coverAlt', { title: localizeDesignTitle(system.title) })} loading="lazy" onError={() => setFailed(true)} />
    : <div className="dsp-cover dsp-cover-missing">{tr('dictUi.ds.coverMissing')}</div>
}
export function DesignPicker({ query }: { query: string }): JSX.Element {
  const tr = useT()
  const lang = useLang()
  const [chosen, setChosen] = useState<DesignSystem>(() => systems.find(s => s.slug === 'chatgpt') || systems[0])
  const [hovered, setHovered] = useState<DesignSystem | null>(null)
  const [interfaceType, setInterfaceType] = useState('all')
  const [tone, setTone] = useState('all')
  const [promptMenu, setPromptMenu] = useState<{x: number; bottom: number} | null>(null)
  const promptMenuRef = useRef<HTMLDivElement>(null)
  const promptButton = useRef<HTMLButtonElement>(null)
  const promptRequest = useRef(0)
  useEffect(() => { promptRequest.current++; setPromptMenu(null); setLoadingSpec(false) }, [chosen.slug])
  useEffect(() => () => { promptRequest.current++ }, [])
  const [preview, setPreview] = useState<{url: string; title: string} | null>(null)
  const previewDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (preview) previewDialog.current?.showModal() }, [preview])
  const [loadingSource, setLoadingSource] = useState(false)
  const sourceRequest = useRef(0)
  useEffect(() => { sourceRequest.current++; setLoadingSource(false) }, [chosen.slug])
  useEffect(() => () => { sourceRequest.current++ }, [])
  const [loadingSpec, setLoadingSpec] = useState(false)
  const [specHint, setSpecHint] = useState<{x: number; y: number} | null>(null)
  const [notice, setNotice] = useState('')
  const target = useRef<ReturnType<typeof useStore.getState>['composerAddChip']>(null)
  const rows = useMemo(() => findDesignSystems(systems, query, tone, interfaceType), [query, tone, interfaceType, lang])
  const shown = hovered || chosen
  const viewing = shown.slug !== chosen.slug
  useEffect(() => { setHovered(null) }, [query, tone, interfaceType])
  useEffect(() => {
    if (!promptMenu) return
    promptMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (e: PointerEvent): void => {
      if (!promptMenuRef.current?.contains(e.target as Node) && !promptButton.current?.contains(e.target as Node)) setPromptMenu(null)
    }
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setPromptMenu(null); promptButton.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [promptMenu])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t) }, [notice])
  const openPreview = (url: string, title = tr('dictUi.ds.preview')): void => {
    setSpecHint(null)
    setPreview({url, title})
  }
  const openSpec = (slug: string): void => {
    if (specIndex[slug]) openPreview(new URL(specIndex[slug] + '.html', window.location.href).href, tr('dictUi.ds.spec'))
  }
  const openPromptMenu = (): void => {
    if (promptMenu) { setPromptMenu(null); return }
    target.current = useStore.getState().composerAddChip
    if (!target.current) { setNotice(tr('dictUi.ds.needTargetPrompt')); return }
    const rect = promptButton.current!.getBoundingClientRect()
    setPromptMenu({x: Math.max(12, Math.min(rect.left, window.innerWidth - 272)), bottom: window.innerHeight - rect.top + 8})
  }
  const attachPrompt = async (scope: DesignScope): Promise<void> => {
    const destination = target.current
    const selected = chosen
    const generation = ++promptRequest.current
    setPromptMenu(null)
    promptButton.current?.focus()
    if (!destination || useStore.getState().composerAddChip !== destination) { setNotice(tr('dictUi.ds.targetChangedPick')); return }
    setLoadingSpec(true)
    try {
      let system = selected
      if (scope === 'system') {
        if (!specIndex[selected.slug]) throw new Error('no full spec')
        const response = await fetch(specIndex[selected.slug] + '.json')
        if (!response.ok) throw new Error('spec load failed')
        system = {...selected, designSpec: await response.json()}
      }
      if (generation !== promptRequest.current) return
      if (useStore.getState().composerAddChip !== destination) { setNotice(tr('dictUi.ds.targetChangedRetry')); return }
      const label = tr(scope === 'colors' ? 'dictUi.ds.chipColors' : 'dictUi.ds.chipSystem', { name: designShortName(selected) })
      destination({id: 'design:' + selected.slug, label, text: designPrompt(system, scope)})
      setNotice(tr('dictUi.ds.added', { label }))
    } catch { if (generation === promptRequest.current) setNotice(tr('dictUi.ds.specFailed')) }
    finally { if (generation === promptRequest.current) setLoadingSpec(false) }
  }
  const attachSource = async (): Promise<void> => {
    const destination = useStore.getState().composerAddChip
    const project = useStore.getState().composerCwd
    if (!destination || !project) { setNotice(tr('dictUi.ds.needTargetSource')); return }
    const selected = chosen
    const generation = ++sourceRequest.current
    setLoadingSource(true)
    try {
      const result = await window.api.dict.designSource(selected.slug, project)
      if (generation !== sourceRequest.current) return
      if (useStore.getState().composerAddChip !== destination) { setNotice(tr('dictUi.ds.targetChangedSource')); return }
      const label = tr('dictUi.ds.chipSource', { name: designShortName(selected) })
      destination({id: 'design-source:' + selected.slug, label, text: tr('dictUi.ds.prompt.source', { label, url: result.url, path: result.path })})
      setNotice(tr('dictUi.ds.sourceAdded', { label, kb: Math.ceil(result.bytes / 1024) }))
    } catch { if (generation === sourceRequest.current) setNotice(tr('dictUi.ds.sourceFailed')) }
    finally { if (generation === sourceRequest.current) setLoadingSource(false) }
  }
  return <div className="dsp-root">
    <main className="dsp-catalog">
      <h2>{tr('dictUi.ds.headline')}</h2><p>{tr('dictUi.ds.lead')}</p>
      <div className="dsp-sticky-filters"><div className="dsp-filters dsp-type-tabs" role="group" aria-label={tr('dictUi.ds.typeAria')}>{interfaceTypeIds.map(v => [v, interfaceTypeLabel(v)] as const).map(([v,label]) => <button key={v} aria-pressed={interfaceType === v} className={interfaceType === v ? 'active' : ''} onClick={() => setInterfaceType(v)}>{label}</button>)}</div>
      <div className="dsp-filters">{[['all',tr('dictUi.ds.toneAll')],['light',tr('dictUi.ds.toneLight')],['dark',tr('dictUi.ds.toneDark')]].map(([v,label]) => <button key={v} className={tone === v ? 'active' : ''} onClick={() => setTone(v)}>{label}</button>)}<small>{tr('dictUi.ds.count', { shown: rows.length, total: systems.length })}</small></div></div>
      <div className="dsp-cards">{rows.map(s => <button key={s.slug} className={'dsp-card' + (s.slug === chosen.slug ? ' active' : '')} aria-pressed={s.slug === chosen.slug} onMouseEnter={() => setHovered(s)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(s)} onBlur={() => setHovered(null)} onClick={() => { setChosen(s); setHovered(null) }}>
        <Sample system={s} /><div className="dsp-card-info"><b>{designShortName(s)}</b><small className="dsp-type-label">{designTypeLabel(s)}</small><small>{tr('dictUi.ds.colors', { services: s.services.map(x => designServiceLabel(x)).join(' / '), n: s.colorCount })}</small></div>
      </button>)}</div>
      {!rows.length && <p className="dsp-empty">{tr('dictUi.ds.empty')}</p>}
      <p className="dsp-footnote">{tr('dictUi.ds.footnote')}</p>
    </main>
    <aside className="dsp-detail"><div className="dsp-detail-scroll"><small>{viewing ? tr('dictUi.ds.hovering') : tr('dictUi.ds.chosen')}</small><h3>{designShortName(shown)}</h3><p className="dsp-type-label" title={designNote(shown.classificationNote)}>{designTypeLabel(shown)}</p><p>{shown.services.map(x => designServiceLabel(x)).join(' / ')} · {shown.tone === 'dark' ? tr('dictUi.ds.toneDark') : shown.tone === 'light' ? tr('dictUi.ds.toneLight') : tr('dictUi.ds.toneMixed')}</p><div className="dsp-preview-block"><button className="dsp-spec-preview" aria-label={tr('dictUi.ds.preview')} disabled={!previews[shown.slug]?.previewUrl} onClick={() => openPreview(previews[shown.slug].previewUrl!)} onPointerMove={e => { if (e.pointerType !== 'touch') setSpecHint({x: Math.min(e.clientX + 14, window.innerWidth - 208), y: Math.min(e.clientY + 18, window.innerHeight - 42)}) }} onPointerLeave={() => setSpecHint(null)} onBlur={() => setSpecHint(null)}><Sample system={shown} /></button><div className="dsp-preview-actions"><button disabled={!previews[shown.slug]?.previewUrl} onClick={() => openPreview(previews[shown.slug].previewUrl!)}>{tr('dictUi.ds.previewBtn')}</button><button disabled={!specIndex[shown.slug]} onClick={() => openSpec(shown.slug)}>{tr('dictUi.ds.specBtn')}</button></div></div>
      {!specIndex[shown.slug] && <p>{tr('dictUi.ds.noSpecPage')}</p>}
      <details><summary>{tr('dictUi.ds.summary', { n: shown.tokenCount })}</summary><pre>{localizeDesignCorpus(shown.corpus)}</pre></details>
      <div className="dsp-swatches">{shown.swatch.slice(0,8).map((c,i) => <span key={i} title={c.n + ': ' + c.v}><i style={{ background: c.v }} />{c.v}</span>)}</div>
      </div><div className="dsp-use"><div className="dsp-use-actions"><button ref={promptButton} className="dsp-primary" aria-haspopup="dialog" aria-expanded={!!promptMenu} disabled={viewing || loadingSpec} onClick={openPromptMenu}>{loadingSpec ? tr('dictUi.ds.loadingSpec') : tr('dictUi.ds.attachPrompt')}</button><button className="dsp-source" title={tr('dictUi.ds.sourceTip')} disabled={viewing || loadingSource || !previews[chosen.slug]?.previewUrl} onClick={() => void attachSource()}>{loadingSource ? tr('dictUi.ds.loadingSource') : tr('dictUi.ds.attachSource')}</button></div><small>{tr('dictUi.ds.noAutoSend')}</small></div>
    </aside>
    {specHint && createPortal(<div className="dsp-spec-hint" role="tooltip" style={{left: specHint.x, top: specHint.y}}>{tr('dictUi.ds.clickPreview')}</div>, document.body)}
    {notice && <div className="dsp-notice" role="status">{notice}</div>}
    {preview && <dialog className="dsp-spec-dialog" ref={previewDialog} onCancel={() => setPreview(null)} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setPreview(null) } }}><header><b>{preview.title}</b><button onClick={() => setPreview(null)}>{tr('dictUi.ds.backToPicker')}</button></header><div className="dsp-browser-popup"><WebView key={preview.url} url={preview.url} selected /></div></dialog>}
    {promptMenu && createPortal(<div ref={promptMenuRef} className="dsp-prompt-menu" data-dict-overlay="prompt-scope" role="dialog" aria-label={tr('dictUi.ds.scopeAria')} style={{left: promptMenu.x, bottom: promptMenu.bottom}}>
      <button onClick={() => void attachPrompt('colors')}><b>{tr('dictUi.ds.colorsOnly')}</b><small>{tr('dictUi.ds.colorsOnlySub')}</small></button>
      <button disabled={!specIndex[chosen.slug]} title={!specIndex[chosen.slug] ? tr('dictUi.ds.noFullSpecTip') : undefined} onClick={() => void attachPrompt('system')}><b>{tr('dictUi.ds.fullSystem')}</b><small>{specIndex[chosen.slug] ? tr('dictUi.ds.fullSystemSub') : tr('dictUi.ds.noFullSpec')}</small></button>
    </div>, document.body)}
  </div>
}
