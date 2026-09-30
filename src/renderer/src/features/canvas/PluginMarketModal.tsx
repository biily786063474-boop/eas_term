import { useT } from '../../i18n.ts'
import type { I18nKey } from '../../../../shared/i18n/index.ts'
import { PluginConfigurationControls } from './PluginConfigurationControls'
import { pluginUpdateAction } from '../../../../shared/pluginUpdate'
import { resolvePluginDetail } from '../../../../shared/pluginDetailBuiltins'
import { missingRequiredSecrets } from './pluginDrawerGate'
// 完整插件市场弹窗（「更多 › 插件」页点「查看完整插件市场」进来）。
// 左边智能分类、顶部搜索、卡片用真实品牌 logo + 名字 + 简介 + 安装。设计稿
// docs/prototype/2026-09-15-plugin-market-full.html。数据来自 registry（可装）+ 已装列表。
import { PluginAccountControls } from './PluginAccountControls'
import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PluginInfo, PluginRegistryEntry, PluginUnavailableEntry } from '../../../../shared/types'
import { MARKET_CATEGORIES, categoryIdOf } from '../../../../shared/pluginCategories'
import { PluginLogo } from './pluginLogos'
import { groupPluginsBySource, excludeSystem } from '../../../../shared/pluginSourceGroups'
import { CategoryIcon } from './pluginCategoryIcons'
import { PlusIcon, CheckIcon, RefreshIcon, CloseIcon } from '../../ui/Icons'

const PERM_LABEL_KEYS: Record<string, I18nKey> = {
  canvas_open_file: 'panels.market.permOpenFile',
  canvas_open_url: 'panels.market.permOpenUrl',
  canvas_add_note: 'panels.market.permAddNote',
  canvas_focus_node: 'panels.market.permFocusNode'
}
const CATEGORY_KEYS: Record<string, I18nKey> = {
  office: 'panels.mk.catOffice',
  life: 'panels.mk.catLife',
  dev: 'panels.mk.catDev',
  comms: 'panels.mk.catComms',
  media: 'panels.mk.catMedia',
  design: 'panels.mk.catDesign',
  data: 'panels.mk.catData',
  storage: 'panels.mk.catStorage',
  other: 'panels.mk.catOther'
}
const fmtSize = (b: number): string =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

type Item = {
  name: string
  displayName: string
  description?: string
  brandColor?: string
  catId: string
  reason?: string
  installed: boolean
  reg?: PluginRegistryEntry
  cli?: string
  plugin?: PluginInfo
}
type Pending = { token: string; name: string; displayName: string; version: string; size: number; permissions: string[]; installed: boolean; permissionChanges?: {added:string[];removed:string[]}|null }

export function PluginMarketModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }): JSX.Element {
  const tr = useT()
  const PERM_LABEL = (p: string): string => (PERM_LABEL_KEYS[p] ? tr(PERM_LABEL_KEYS[p]) : p)
  const catName = (c: { id: string; name: string }): string => (CATEGORY_KEYS[c.id] ? tr(CATEGORY_KEYS[c.id]) : c.name)
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [reg, setReg] = useState<{ entries: PluginRegistryEntry[]; unavailable: PluginUnavailableEntry[]; stale:boolean } | null | 'error'>(null)
  const [active, setActive] = useState<string>('featured')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Pending | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sources,setSources]=useState<{id:string;name:string;url:string}[]>([])
  const [sourceId,setSourceId]=useState('')
  const [sourceForm,setSourceForm]=useState(false)
  const [sourceName,setSourceName]=useState('')
  const [sourceUrl,setSourceUrl]=useState('')
  const refreshGeneration=useRef(0)
  const [err, setErr] = useState<string | null>(null)
  const [setupPlugin, setSetupPlugin] = useState<PluginInfo | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const backToList = (): void => { setSelected(null); requestAnimationFrame(() => returnFocus.current?.focus()) }

  const reload = (): Promise<void> =>
    window.api.plugins
      .list()
      .then((l) => setPlugins(l))
      .catch(() => setPlugins([]))
  const refreshRegistry = async (): Promise<void> => {
    const generation=++refreshGeneration.current
    setRefreshing(true)
    setErr(null)
    try {
      await reload()
      const r = await window.api.plugins.registry(sourceId || undefined)
      if(generation!==refreshGeneration.current)return
      if(!r.ok)setErr(r.error)
      setReg(r.ok ? { entries:r.entries, unavailable:r.unavailable??[], stale:r.stale } : 'error')
    } catch { if(generation===refreshGeneration.current)setReg('error') }
    finally { if(generation===refreshGeneration.current)setRefreshing(false) }
  }
  useEffect(() => {
    setSelected(null); setReg(null); void refreshRegistry()
    return ()=>{refreshGeneration.current++}
  }, [sourceId])
  useEffect(()=>{void window.api.plugins.sources({action:'list'}).then(r=>{if(r.ok)setSources(r.sources);else setErr(r.error)})},[])
  const changeSources=async(action:'add'|'remove')=>{
    setBusy('source-management');setErr(null)
    try{const r=await window.api.plugins.sources(action==='add'?{action,name:sourceName,url:sourceUrl}:{action,id:sourceId});if(!r.ok){setErr(r.error);return}setSources(r.sources);setSourceForm(false);setSourceName('');setSourceUrl('');if(action==='remove')setSourceId('')}catch(e){setErr(String(e))}finally{setBusy(null)}
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (confirm) { setConfirm(null); return }
        if (selected) { backToList(); return }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, selected, confirm])

  // ── 合并 registry（可装）+ 已装，成统一条目，按名去重 ──
  const allItems: Item[] = (() => {
    const map = new Map<string, Item>()
    const installedEas = new Set((plugins ?? []).filter((p) => p.cli === 'eas').map((p) => p.name))
    if (reg && reg !== 'error') {
      for(const e of reg.unavailable){
        map.set(e.name,{name:e.name,displayName:e.displayName,description:e.description,brandColor:e.brandColor,catId:categoryIdOf(e.category),installed:installedEas.has(e.name),reason:e.reason})
      }
      for (const e of reg.entries) {
        map.set(e.name, {
          name: e.name,
          displayName: e.displayName,
          description: e.description,
          brandColor: e.brandColor,
          catId: categoryIdOf(e.category),
          installed: installedEas.has(e.name),
          reg: { ...e, detail: resolvePluginDetail(e) }
        })
      }
    }
    for (const p of plugins ?? []) {
      if (p.cli === 'eas' && map.has(p.name)) {
        map.get(p.name)!.installed = true
        map.get(p.name)!.plugin = p
        continue
      }
      map.set(p.cli === 'eas' ? p.name : p.id, {
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        brandColor: p.brandColor,
        catId: categoryIdOf(p.category),
        installed: true,
        plugin: p,
        cli: p.cli
      })
    }
    return [...map.values()]
  })()

  // 「已安装」不列 system 内置能力（开关在设置 → 内置能力）；分组由 groupPluginsBySource 完成
  // system 内置能力在弹窗任何页都不出现（精选/分类/搜索/已安装/详情）；installed 标记已在 allItems 里算完
  const items = excludeSystem(allItems, (it) => it.plugin)
  const installedItems = items.filter((it) => it.installed)
  const kw = q.trim().toLowerCase()
  const selectedItem = items.find(it => (it.plugin?.id ?? it.name) === selected)
  const selectedSameSource = !selectedItem?.plugin || (selectedItem.plugin.marketSource?.id ?? 'official') === (sourceId || 'official')
  const selectedAction = selectedSameSource && selectedItem?.plugin && selectedItem.reg ? pluginUpdateAction(selectedItem.plugin, selectedItem.reg.version) : null
  const catCount = (id: string): number => items.filter((it) => it.catId === id).length

  const startInstall = async (name: string): Promise<void> => {
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.install(name,sourceId || undefined)
      if (!r.ok) setErr(r.error)
      else setConfirm(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const commitInstall = async (): Promise<void> => {
    if (!confirm) return
    const { token, name } = confirm
    setConfirm(null)
    setBusy(name)
    setErr(null)
    try {
      const r = await window.api.plugins.installCommit(token)
      if (!r.ok) setErr(r.error)
      else {
        const updated = await window.api.plugins.list()
        setPlugins(updated)
        onChanged()
        const item = updated.find(p => p.cli === 'eas' && p.name === name)
        if (item?.config?.fields.some(field => field.required && field.type === 'secret')) {
          const status = await window.api.plugins.configuration('status', item.id)
          if (!status.ok || missingRequiredSecrets(item, status.configured).length) setSetupPlugin(item)
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const card = (it: Item): JSX.Element => {
    const working = busy === it.name
    const sameSource = !it.plugin || (it.plugin.marketSource?.id ?? 'official') === (sourceId || 'official')
    const action = sameSource && it.plugin && it.reg ? pluginUpdateAction(it.plugin,it.reg.version) : null
    const update = action === 'update'
    return (
      <div key={it.plugin?.id ?? it.name} className="pm-card" onClick={e => {
        if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea')) return
        returnFocus.current = e.currentTarget.querySelector('.pm-card-open')
        setSelected(it.plugin?.id ?? it.name)
      }}>
        <button className="pm-card-open" aria-label={tr('panels.mk.viewDetail',{name:it.displayName})} onClick={e => { returnFocus.current=e.currentTarget; setSelected(it.plugin?.id ?? it.name) }}>
        <PluginLogo name={it.name} brandColor={it.brandColor} iconDataUrl={it.plugin?.iconDataUrl ?? it.reg?.iconDataUrl} />
        <span className="pm-cb">
          <div className="pm-ct">
            <b>{it.displayName}</b>
            {it.cli && it.cli !== 'eas' && <span className="pm-src">{it.cli === 'claude' ? 'Claude' : 'Codex'}</span>}
          </div>
          <div className="pm-cd pm-card-description" title={it.description}>{it.description || tr('panels.mk.noDesc')}</div>
          <div className="pm-card-meta">
            <span className="pm-cd pm-card-status" title={it.plugin?.version ? tr('panels.mk.installedV',{v:it.plugin.version}) : undefined}>
              {!sameSource && it.reg ? tr('panels.mk.sourceMismatch') : it.reason ? tr('panels.mk.notOpen') : it.plugin?.cli === 'eas' ? `${it.plugin.version ? tr('panels.mk.installedV',{v:it.plugin.version}) : tr('panels.mk.installedNoVer')}${update ? ' · ' + tr('panels.mk.updateV',{v:it.reg!.version}) : ''}${it.plugin.builtin ? ' · ' + tr('panels.mk.builtinCopy') : ''}` : it.installed ? tr('panels.mk.installed') : tr('panels.mk.notInstalled')}
            </span>
          </div>
        </span>
        </button>
        <div className="pm-cact">
          {it.plugin?.config&&<PluginConfigurationControls plugin={it.plugin}/>}
          {it.plugin?.remote?.auth==='oauth'&&<PluginAccountControls id={it.plugin.id} title={it.displayName} enabled={it.plugin.enabled!==false}/>}
          {working ? (
            <span className="pm-spin"><RefreshIcon size={13} /></span>
          ) : action ? (
            <button className="cpk-btn ghost pm-update-action" title={action === 'migrate' ? tr('panels.mk.migrateTip') : tr('panels.mk.updateTo',{v:it.reg!.version})} aria-label={tr(action === 'migrate' ? 'panels.mk.migrateAria' : 'panels.mk.updateAria',{name:it.displayName,v:it.reg!.version})} disabled={!!busy || !!confirm || refreshing} onClick={() => startInstall(it.name)}>
              <RefreshIcon size={16} />{action === 'migrate' ? tr('panels.mk.migrate') : tr('panels.mk.update')}
            </button>
          ) : it.installed ? (
            <span className="pm-done" title={tr('panels.mk.installed')}><CheckIcon size={15} /></span>
          ) : it.reg ? (
            <button className="pm-add" title={tr('panels.mk.connect')} disabled={!!busy || !!confirm || refreshing} onClick={() => startInstall(it.name)}>
              <PlusIcon size={16} />
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  // ── 主区渲染 ──
  let body: JSX.Element
  if (plugins === null || reg === null) {
    body = <div className="pm-empty">{tr('panels.market.loading')}</div>
  } else if (kw) {
    const hits = items.filter((it) => (it.displayName + (it.description ?? '')).toLowerCase().includes(kw))
    body = (
      <>
        <div className="pm-sech">
          {tr('panels.mk.searchHead',{q})}<span className="pm-n">{tr('panels.mk.countN',{n:hits.length})}</span>
        </div>
        {hits.length ? <div className="pm-grid">{hits.map(card)}</div> : <div className="pm-empty">{tr('panels.mk.noResults')}</div>}
      </>
    )
  } else if (active === 'featured') {
    body = (
      <>
        {MARKET_CATEGORIES.filter((c) => catCount(c.id)).map((c) => (
          <div key={c.id}>
            <div className="pm-sech">
              <CategoryIcon id={c.id} size={15} /> {catName(c)}
            </div>
            <div className="pm-grid">{items.filter((it) => it.catId === c.id).map(card)}</div>
          </div>
        ))}
        {!items.length && <div className="pm-empty">{tr('panels.mk.catalogSoon')}</div>}
      </>
    )
  } else if (active === 'installed') {
    const list = installedItems
    body = (
      <>
        <div className="pm-sech">
          {tr('panels.market.installed')} <span className="pm-n">{tr('panels.mk.countN',{n:list.length})}</span>
        </div>
        {groupPluginsBySource(list, (it) => ({ cli: it.plugin?.cli ?? 'eas', system: it.plugin?.system })).map((g) => (
          <div key={g.key} role="group" aria-label={tr(g.titleKey)}>
            <div className="pm-sech pm-sech-sub">{tr(g.titleKey)} <span className="pm-n">{tr('panels.mk.countN',{n:g.items.length})}</span></div>
            <div className="pm-grid">{g.items.map(card)}</div>
          </div>
        ))}
        {!list.length && <div className="pm-empty">{tr('panels.mk.noneInstalled')}</div>}
      </>
    )
  } else {
    const c = MARKET_CATEGORIES.find((x) => x.id === active)
    const list = items.filter((it) => it.catId === active)
    body = (
      <>
        <div className="pm-sech">
          {c && <CategoryIcon id={c.id} size={15} />} {c ? catName(c) : undefined} <span className="pm-n">{tr('panels.mk.countN',{n:list.length})}</span>
        </div>
        {list.length ? <div className="pm-grid">{list.map(card)}</div> : <div className="pm-empty">{tr('panels.mk.catEmpty')}</div>}
      </>
    )
  }

  return createPortal(
    <div className="pm-back" onMouseDown={onClose}>
      <div className="pm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pm-side">
          <h1 className="pm-title">{tr('panels.mk.title')}</h1>
          <p className="pm-sub">{tr('panels.mk.subtitle')}</p>
          <nav className="pm-nav">
            <div className="pm-navg">{tr('panels.mk.browse')}</div>
            <button className={`pm-navb${active === 'featured' ? ' on' : ''}`} onClick={() => {setActive('featured');setSelected(null)}}>
              <span className="pm-ci">
                <CategoryIcon id="featured" />
              </span>
              <span className="pm-cn">{tr('panels.mk.featured')}</span>
              <span className="pm-cc">{items.length}</span>
            </button>
            <button className={`pm-navb${active === 'installed' ? ' on' : ''}`} onClick={() => {setActive('installed');setSelected(null)}}>
              <span className="pm-ci">
                <CategoryIcon id="installed" />
              </span>
              <span className="pm-cn">{tr('panels.market.installed')}</span>
              <span className="pm-cc">{installedItems.length}</span>
            </button>
            <div className="pm-navg">{tr('panels.mk.categories')}</div>
            {MARKET_CATEGORIES.map((c) => (
              <button key={c.id} className={`pm-navb${active === c.id ? ' on' : ''}`} onClick={() => {setActive(c.id);setSelected(null)}}>
                <span className="pm-ci">
                  <CategoryIcon id={c.id} />
                </span>
                <span className="pm-cn">{catName(c)}</span>
                <span className="pm-cc">{catCount(c.id)}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="pm-main">
          <div className="pm-head">
            <div className="pm-search">
              <span className="pm-mag">⌕</span>
              <input value={q} onChange={(e) => {setQ(e.target.value);setSelected(null)}} placeholder={tr('panels.mk.searchPh')} autoFocus />
            </div>
            <button className="cpk-btn ghost" title={tr('panels.mk.checkTip')} aria-label={tr('panels.mk.checkUpdates')} disabled={refreshing || !!busy || !!confirm} onClick={() => void refreshRegistry()}>
              <RefreshIcon size={16} />{refreshing ? tr('panels.mk.checking') : tr('panels.mk.checkUpdates')}
            </button>
            <button className="pm-close" title={tr('panels.mk.close')} onClick={onClose}>
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="pm-sources">
            <label>{tr('panels.mk.sourceLabel')} <select aria-label={tr('panels.mk.sourceLabel')} value={sourceId} disabled={!!busy||!!confirm} onChange={e=>setSourceId(e.target.value)}><option value="">{tr('panels.mk.easOfficial')}</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <button className="cpk-btn ghost" disabled={!!busy||!!confirm} onClick={()=>setSourceForm(v=>!v)}>{tr('panels.mk.addSource')}</button>
            {sourceId&&<button className="cpk-btn ghost" disabled={!!busy||!!confirm} onClick={()=>void changeSources('remove')}>{tr('panels.mk.removeSource')}</button>}
          </div>
          {sourceForm&&<section className="pm-source-form" aria-label={tr('panels.mk.addSource')}>
            <b>{tr('panels.mk.addCatalog')}</b>
            <p>{tr('panels.mk.sourceHelp')}</p>
            <input aria-label={tr('panels.mk.sourceName')} placeholder={tr('panels.mk.sourceName')} maxLength={80} value={sourceName} onChange={e=>setSourceName(e.target.value)}/>
            <input aria-label={tr('panels.mk.sourceUrlLabel')} placeholder="https://example.com/plugins/registry.json" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)}/>
            <button className="cpk-btn primary" disabled={!!busy||!sourceName.trim()||!sourceUrl.trim()} onClick={()=>void changeSources('add')}>{tr('panels.mk.addSourceBtn')}</button>
          </section>}
          {err && <div className="pm-err">{err}</div>}
          {reg && reg !== 'error' && reg.stale && <div className="pm-err">{tr('panels.mk.staleWarn')}</div>}
          {reg && reg !== 'error' && <div className="pm-sech">{tr('panels.mk.regSummary',{pub:reg.entries.length,pending:reg.unavailable.length})}</div>}
          {reg === 'error' && <div className="pm-err">{tr('panels.mk.regError')}</div>}
          <div className="pm-body" ref={listRef} hidden={!!selectedItem}>{body}</div>
          {selectedItem && <div className="pm-body pm-detail" role="region" aria-label={tr('panels.mk.detailAria',{name:selectedItem.displayName})}>
            <button className="pm-detail-back" onClick={backToList}>{tr('panels.mk.backToList')}</button>
            <div className="pm-detail-hero"><PluginLogo name={selectedItem.name} brandColor={selectedItem.brandColor} iconDataUrl={selectedItem.plugin?.iconDataUrl ?? selectedItem.reg?.iconDataUrl} /><div><div className="pm-detail-kicker">{tr('panels.mk.detailKicker',{v:selectedItem.reg?.version ? `v${selectedItem.reg.version}` : selectedItem.plugin?.version ? `v${selectedItem.plugin.version}` : tr('panels.mk.noVersion')})}</div><h2>{selectedItem.displayName}</h2><p>{selectedItem.reg?.detail?.summary ?? selectedItem.description ?? tr('panels.mk.noSummary')}</p></div>{selectedItem.reg && selectedSameSource && (!selectedItem.installed || selectedAction) && <button className="cpk-btn primary pm-detail-action" disabled={!!busy || !!confirm || refreshing} onClick={() => void startInstall(selectedItem.name)}>{selectedAction === 'update' ? tr('panels.mk.updatePlugin') : selectedAction === 'migrate' ? tr('panels.mk.migrate') : tr('panels.mk.installPlugin')}</button>}</div>
            {selectedItem.reason && <div className="pm-detail-warning">{tr('panels.mk.notOpenReason',{reason:selectedItem.reason})}</div>}
            {!selectedSameSource && selectedItem.reg && <div className="pm-detail-warning">{tr('panels.mk.crossSource')}</div>}
            {selectedItem.plugin?.shadowedBuiltin && <div className="pm-detail-warning">{selectedItem.plugin.shadowedBuiltin}</div>}
            <div className="pm-detail-grid">
              <section><h3>{tr('panels.mk.secScenarios')}</h3>{selectedItem.reg?.detail?.scenarios?.length ? <ul>{selectedItem.reg.detail.scenarios.map((x,i)=><li key={i}>{x}</li>)}</ul> : <p>{tr('panels.mk.noScenarios')}</p>}</section>
              <section><h3>{tr('panels.mk.secHowTo')}</h3>{selectedItem.reg?.detail?.steps?.length ? <ol>{selectedItem.reg.detail.steps.map((x,i)=><li key={i}>{x}</li>)}</ol> : <p>{tr('panels.mk.noSteps')}</p>}</section>
              <section className="pm-detail-wide"><h3>{tr('panels.mk.secCaps')}</h3>{selectedItem.reg?.detail?.capabilities?.length ? <div className="pm-detail-capabilities">{selectedItem.reg.detail.capabilities.map((x,i)=><div key={i}><b>{x.title}</b><span>{x.kind==='tool' ? tr('panels.mk.kindTool') : x.kind==='panel' ? tr('panels.mk.kindPanel') : tr('panels.mk.kindTip')}</span><p>{x.description}</p>{x.tool && <code>{x.tool}</code>}</div>)}</div> : <p>{tr('panels.mk.noCaps')}</p>}</section>
              <section><h3>{tr('panels.mk.secPerms')}</h3><p>{tr('panels.mk.permsSentence',{perms:selectedItem.reg?.permissions && Object.values(selectedItem.reg.permissions).flat().length ? Object.values(selectedItem.reg.permissions).flat().map(x=>PERM_LABEL(x)).join(tr('panels.mk.listSep')) : tr('panels.mk.noCanvasPerms')})}</p><p>{selectedItem.reg?.detail?.dataUse ?? tr('panels.mk.noDataUse')}</p></section>
              <section><h3>{tr('panels.mk.secCompat')}</h3><p>{selectedItem.reg?.detail?.limitations ?? tr('panels.mk.noLimits')}</p><p>{tr('panels.mk.sourceIs',{src:selectedItem.plugin?.marketSource?.url ?? (sourceId ? sources.find(s=>s.id===sourceId)?.name ?? tr('panels.mk.externalMarket') : tr('panels.mk.easOfficialMarket'))})}</p></section>
              <section className="pm-detail-wide"><h3>{tr('panels.mk.secChangelog')}</h3><p>{selectedItem.reg?.detail?.changelog ?? tr('panels.mk.noChangelog')}</p>{selectedItem.reg?.detail?.supportUrl && <p>{tr('panels.mk.support',{url:selectedItem.reg.detail.supportUrl})}</p>}</section>
            </div>
          </div>}
        </div>
      </div>

      {/* 权限确认框（层级高于市场弹窗）*/}
      {confirm && (
        <div className="cpk-modal-back" style={{ zIndex: 1600 }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="cpk-modal">
            <div className="cpk-modal-title">{confirm.installed ? tr('panels.mk.updateTitle',{name:confirm.displayName}) : tr('panels.market.installTitle',{name:confirm.displayName})}</div>
            <div className="cpk-modal-sub">
              v{confirm.version} · {fmtSize(confirm.size)}
              <p>{tr('panels.mk.confirmSource',{src:sources.find(s=>s.id===sourceId)?.url ?? tr('panels.mk.easOfficial')})}</p>
              <p>{tr('panels.mk.confirmReplace')}</p>
            </div>
            {confirm.installed&&<section aria-label={tr('panels.mk.permChangesAria')}>
              <div className="cpk-modal-label">{tr('panels.mk.permChangesHead')}</div>
              {confirm.permissionChanges==null?<div className="cpk-modal-sub">{tr('panels.mk.permUnverifiable')}</div>:<>
                {confirm.permissionChanges.added.length>0&&<ul className="cpk-perms">{confirm.permissionChanges.added.map(p=><li key={p}>{tr('panels.mk.permAdded',{perm:PERM_LABEL(p)})}</li>)}</ul>}
                {confirm.permissionChanges.removed.length>0&&<ul className="cpk-perms">{confirm.permissionChanges.removed.map(p=><li key={p}>{tr('panels.mk.permRemoved',{perm:PERM_LABEL(p)})}</li>)}</ul>}
                {!confirm.permissionChanges.added.length&&!confirm.permissionChanges.removed.length&&<div className="cpk-modal-sub">{tr('panels.mk.permUnchanged')}</div>}
              </>}
            </section>}
            {confirm.permissions.length ? (
              <>
                <div className="cpk-modal-label">{tr('panels.market.canDo')}</div>
                <ul className="cpk-perms">
                  {confirm.permissions.map((p) => (
                    <li key={p}>{PERM_LABEL(p)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="cpk-modal-label">{tr('panels.market.noPerms')}</div>
            )}
            <div className="cpk-modal-acts">
              <button className="cpk-btn ghost" onClick={() => setConfirm(null)}>
                {tr('panels.common.cancel')}
              </button>
              <button className="cpk-btn primary" onClick={commitInstall}>
                {confirm.installed ? tr('panels.mk.confirmUpdate') : tr('panels.market.confirmInstall')}
              </button>
            </div>
          </div>
        </div>
      )}
      {setupPlugin && <div onMouseDown={e => e.stopPropagation()}><PluginConfigurationControls key={setupPlugin.id} plugin={setupPlugin} initialOpen onClose={() => setSetupPlugin(null)} /></div>}
    </div>,
    document.body
  )
}
