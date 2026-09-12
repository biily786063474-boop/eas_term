import { WebView } from '../web/WebView'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import systems from './design-systems.json'
import { designPrompt, findDesignSystems, interfaceTypeLabels, designTypeLabel } from './designSystems'
import type { DesignScope, DesignSystem } from './designSystems'
import './designPicker.css'
import specIndexData from './design-spec-index.json'
const specIndex = specIndexData as Record<string, string>
import previewData from './design-previews.json'
const previews = previewData as Record<string, { cover: string; previewUrl?: string }>
function Sample({ system }: { system: DesignSystem }): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [system.slug])
  const source = previews[system.slug]
  return source?.cover && !failed
    ? <img className="dsp-cover" src={source.cover} alt={system.title + ' · 原页面实渲封面'} loading="lazy" onError={() => setFailed(true)} />
    : <div className="dsp-cover dsp-cover-missing">原页面封面暂不可用</div>
}
export function DesignPicker({ query }: { query: string }): JSX.Element {
  const [chosen, setChosen] = useState<DesignSystem>(() => systems.find(s => s.slug === 'chatgpt') || systems[0])
  const [hovered, setHovered] = useState<DesignSystem | null>(null)
  const [interfaceType, setInterfaceType] = useState('all')
  const [tone, setTone] = useState('all')
  const [scope, setScope] = useState<DesignScope>('colors')
  const [preview, setPreview] = useState<{url: string; title: string} | null>(null)
  const previewDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (preview) previewDialog.current?.showModal() }, [preview])
  const [loadingSpec, setLoadingSpec] = useState(false)
  const [specHint, setSpecHint] = useState<{x: number; y: number} | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const target = useRef<ReturnType<typeof useStore.getState>['composerAddChip']>(null)
  const rows = useMemo(() => findDesignSystems(systems, query, tone, interfaceType), [query, tone, interfaceType])
  const shown = hovered || chosen
  const viewing = shown.slug !== chosen.slug
  useEffect(() => { setHovered(null) }, [query, tone, interfaceType])
  useEffect(() => {
    if (draft === null) return
    const prior = document.activeElement as HTMLElement | null
    const el = dialog.current
    el?.showModal()
    return () => { el?.close(); if (prior?.isConnected) prior.focus({ preventScroll: true }) }
  }, [draft === null])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t) }, [notice])
  const openPreview = (url: string, title = '预览效果'): void => {
    setSpecHint(null)
    setPreview({url, title})
  }
  const openSpec = (slug: string): void => {
    if (specIndex[slug]) openPreview(new URL(specIndex[slug] + '.html', window.location.href).href, '设计规范')
  }
  const prepare = async (): Promise<void> => {
    target.current = useStore.getState().composerAddChip
    if (scope === 'system' && specIndex[chosen.slug]) {
      setLoadingSpec(true)
      try {
        const response = await fetch(specIndex[chosen.slug] + '.json')
        if (!response.ok) throw new Error('spec load failed')
        const designSpec = await response.json()
        setDraft(designPrompt({ ...chosen, designSpec }, scope))
      } catch { setNotice('完整规范读取失败，请重试；未降级为摘要。') }
      finally { setLoadingSpec(false) }
    } else setDraft(designPrompt(chosen, scope))
  }
  const attach = (): void => {
    const live = useStore.getState().composerAddChip
    if (!live || live !== target.current) {
      setNotice('目标输入框已变化。请返回，点一下目标 AI 输入框，再打开确认。')
      return
    }
    if (!draft?.trim()) return
    live({ id: 'design:' + chosen.slug, label: chosen.title.split(' Design')[0].split(' 设计系统')[0] + ' · ' + (scope === 'colors' ? '配色' : '设计系统'), text: draft })
    setDraft(null)
    setNotice('已加入 AI 输入框；与当前需求一起发送后生效。')
  }
  return <div className="dsp-root">
    <main className="dsp-catalog">
      <h2>让设计参考，说得清楚。</h2><p>看界面气质，选设计规范，带进 AI 对话。</p>
      <div className="dsp-filters dsp-type-tabs" role="group" aria-label="界面类型">{Object.entries(interfaceTypeLabels).map(([v,label]) => <button key={v} aria-pressed={interfaceType === v} className={interfaceType === v ? 'active' : ''} onClick={() => setInterfaceType(v)}>{label}</button>)}</div>
      <div className="dsp-filters">{[['all','全部'],['light','亮色'],['dark','暗色']].map(([v,label]) => <button key={v} className={tone === v ? 'active' : ''} onClick={() => setTone(v)}>{label}</button>)}<small>{rows.length} / {systems.length} 套</small></div>
      <div className="dsp-cards">{rows.map(s => <button key={s.slug} className={'dsp-card' + (s.slug === chosen.slug ? ' active' : '')} aria-pressed={s.slug === chosen.slug} onMouseEnter={() => setHovered(s)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(s)} onBlur={() => setHovered(null)} onClick={() => { setChosen(s); setHovered(null) }}>
        <Sample system={s} /><div className="dsp-card-info"><b>{s.title.split(' Design')[0].split(' 设计系统')[0]}</b><small className="dsp-type-label">{designTypeLabel(s)}</small><small>{s.services.join(' / ')} · {s.colorCount} 色</small></div>
      </button>)}</div>
      {!rows.length && <p className="dsp-empty">没有匹配的设计系统，试试其他关键词、界面类型或明暗筛选。</p>}
      <p className="dsp-footnote">本地选型库摘要，非官方最新规范；封面来自本地原始页面渲染，点击原始预览可体验页面。</p>
    </main>
    <aside className="dsp-detail"><div className="dsp-detail-scroll"><small>{viewing ? '悬停预览 · 点击卡片选定' : '已选定 · 本次设计参考'}</small><h3>{shown.title.split(' Design')[0].split(' 设计系统')[0]}</h3><p className="dsp-type-label" title={shown.classificationNote}>{designTypeLabel(shown)}</p><p>{shown.services.join(' / ')} · {shown.tone === 'dark' ? '暗色' : shown.tone === 'light' ? '亮色' : '混合'}</p><div className="dsp-preview-block"><button className="dsp-spec-preview" aria-label="预览效果" disabled={!previews[shown.slug]?.previewUrl} onClick={() => openPreview(previews[shown.slug].previewUrl!)} onPointerMove={e => { if (e.pointerType !== 'touch') setSpecHint({x: Math.min(e.clientX + 14, window.innerWidth - 208), y: Math.min(e.clientY + 18, window.innerHeight - 42)}) }} onPointerLeave={() => setSpecHint(null)} onBlur={() => setSpecHint(null)}><Sample system={shown} /></button><div className="dsp-preview-actions"><button disabled={!previews[shown.slug]?.previewUrl} onClick={() => openPreview(previews[shown.slug].previewUrl!)}>↗ 预览效果</button><button disabled={!specIndex[shown.slug]} onClick={() => openSpec(shown.slug)}>▤ 规范</button></div></div>
      {!specIndex[shown.slug] && <p>未收录独立设计规范页，仅有摘要。</p>}
      <details><summary>设计系统摘要 · {shown.tokenCount} 个 token</summary><pre>{shown.corpus}</pre></details>
      <div className="dsp-swatches">{shown.swatch.slice(0,8).map((c,i) => <span key={i} title={c.n + ': ' + c.v}><i style={{ background: c.v }} />{c.v}</span>)}</div>
      </div><div className="dsp-use"><b>这次参考什么？</b><div className="dsp-scope">{[['colors','只参考配色'],['system','完整设计系统']].map(([v,label]) => <button key={v} className={scope === v ? 'active' : ''} onClick={() => setScope(v as DesignScope)}>{label}</button>)}</div>
      <p>{scope === 'colors' ? '保留当前项目的字体、圆角、布局与动效。' : '附带规范页正文和全部 tokens；与项目规范冲突时先说明。'}</p><button className="dsp-primary" disabled={viewing || loadingSpec} onClick={() => void prepare()}>{loadingSpec ? '读取完整规范…' : viewing ? '点击卡片选定后使用' : '预览提示词 →'}</button><small>复用辞典引用，加入 AI 输入框后随消息发送。</small></div>
    </aside>
    {specHint && createPortal(<div className="dsp-spec-hint" role="tooltip" style={{left: specHint.x, top: specHint.y}}>点击预览效果 ↗</div>, document.body)}
    {notice && <div className="dsp-notice" role="status">{notice}</div>}
    {preview && <dialog className="dsp-spec-dialog" ref={previewDialog} onCancel={() => setPreview(null)} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setPreview(null) } }}><header><b>{preview.title}</b><button onClick={() => setPreview(null)}>返回选型 ×</button></header><div className="dsp-browser-popup"><WebView key={preview.url} url={preview.url} selected /></div></dialog>}
    {draft !== null && <dialog className="dsp-dialog" ref={dialog} onClick={e => { if (e.target === e.currentTarget) { const r=e.currentTarget.getBoundingClientRect(); if (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) setDraft(null) } }} onCancel={() => setDraft(null)}><h2>把选中的规范带进对话</h2><p>只带这一套参考，不发送整个设计库。</p><p className="dsp-target">{target.current ? '目标：最近聚焦的 AI 对话输入框' : '尚未选择目标：返回后先点一下 AI 输入框。'}</p><textarea aria-label="设计提示词" value={draft} onChange={e => setDraft(e.target.value)} /><div className="dsp-dialog-actions"><button onClick={() => setDraft(null)}>返回选型</button><button className="dsp-primary" disabled={!target.current || !draft.trim()} onClick={attach}>加入 AI 输入框</button></div><small>不会自动启动模型；你可与当前需求一起发送。</small>{notice && <p role="status">{notice}</p>}</dialog>}
  </div>
}
