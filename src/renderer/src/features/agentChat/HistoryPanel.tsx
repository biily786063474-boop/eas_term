import { useEffect, useRef, useState } from 'react'
import type { HistorySummary } from '../../../../shared/historyCatalog'
import type { Turn } from './reduce'
import { MessageList } from './MessageList'
import { settleOnLoad } from './history'
import { CloseIcon, MessageIcon } from '../../ui/Icons'
import './historyPanel.css'
import { useT } from '../../i18n.ts'

/** Reading history never sends a prompt or starts a CLI. */
export function HistoryPanel({ cwd, moduleId, currentKey, leafId, onClose, onResume, canResume }: {
  cwd: string; moduleId: string; currentKey: string; leafId: string
  onClose: () => void; onResume: (h: HistorySummary) => Promise<void>; canResume: boolean
}): JSX.Element {
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [scope, setScope] = useState<'module' | 'project' | 'pinned'>('project')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<HistorySummary[]>([])
  const [selected, setSelected] = useState<HistorySummary | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    search.current?.focus({ preventScroll: true })
    const outside = (e: PointerEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) closeRef.current()
    }
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [])
  useEffect(() => {
    let alive = true
    setLoading(true)
    const timer = setTimeout(() => {
      void window.api.agentChat.listHistory(cwd, query).then(list => {
        if (alive) { setItems(list); setLoading(false) }
      }).catch(() => { if (alive) { setError(t('chat.history.loadFail')); setLoading(false) } })
    }, 150)
    return () => { alive = false; clearTimeout(timer) }
  }, [cwd, query, revision])
  useEffect(() => {
    let alive = true
    setTurns([])
    if (!selected) return
    setReading(true)
    void window.api.agentChat.loadHistory(selected.leafId).then(h => {
      if (alive) { setTurns(settleOnLoad(h.turns as Turn[])); setReading(false) }
    }).catch(() => { if (alive) { setError(t('chat.history.readFail')); setReading(false) } })
    return () => { alive = false }
  }, [selected?.leafId])
  const visible = items.filter(h => scope === 'project' || (scope === 'pinned' ? h.pinned : h.moduleId === moduleId || h.leafId === moduleId || h.leafId === currentKey))
  const pin = async (): Promise<void> => {
    if (!selected || working) return
    setWorking(true)
    try {
      if (!await window.api.agentChat.pinHistory(selected.leafId, cwd, !selected.pinned)) throw new Error()
      setSelected({ ...selected, pinned: !selected.pinned }); setRevision(x => x + 1)
    } catch { setError(t('chat.history.pinFail')) } finally { setWorking(false) }
  }
  return <div className={'ac-history-panel' + (selected ? ' has-detail' : '')} ref={root} role="region" aria-label={t('chat.history.title')} onPointerDown={e => e.stopPropagation()}>
    <header className="ac-history-head"><div><strong>{t('chat.history.title')}</strong><small>{t('chat.history.subtitle')}</small></div><button type="button" aria-label={t('chat.history.closeAria')} onClick={onClose}><CloseIcon size={15} /></button></header>
    <div className="ac-history-filters">
      <nav aria-label={t('chat.history.scopeAria')}>{([['module',t('chat.history.scopeModule')],['project',t('chat.history.scopeProject')],['pinned',t('chat.history.scopePinned')]] as const).map(([id,label]) => <button key={id} type="button" aria-pressed={scope === id} onClick={() => { setScope(id); setSelected(null) }}>{label}</button>)}</nav>
      <input ref={search} aria-label={t('chat.history.searchAria')} placeholder={t('chat.history.searchPh')} value={query} onChange={e => { setQuery(e.target.value); setSelected(null) }} />
    </div>
    {error && <div className="ac-history-error" role="alert">{error}<button type="button" onClick={() => { setError(''); setRevision(x => x + 1) }}>{t('chat.history.retry')}</button></div>}
    <div className="ac-history-body">
      <div className="ac-history-list">
        {loading ? <p className="ac-history-empty">{t('chat.history.loading')}</p> : visible.length ? visible.map(h => <button type="button" key={h.leafId} className={selected?.leafId === h.leafId ? 'selected' : ''} onClick={() => setSelected(h)}>
          <span className="ac-history-title"><MessageIcon size={13} /><span>{h.preview || t('chat.history.noText')}</span>{h.pinned && <small>{t('chat.history.scopePinned')}</small>}</span>
          <small>{t(h.leafId === currentKey ? 'chat.history.metaCurrent' : 'chat.history.meta', { date: new Date(h.savedAt).toLocaleDateString(), n: h.turns })}</small>
        </button>) : <p className="ac-history-empty">{query ? t('chat.history.emptyMatch') : scope === 'module' ? t('chat.history.emptyModule') : scope === 'pinned' ? t('chat.history.emptyPinned') : t('chat.history.emptyAll')}</p>}
      </div>
      <section className="ac-history-detail" aria-label={t('chat.history.previewAria')}>
        {selected ? <>
          <div className="ac-history-detail-head"><button type="button" className="ac-history-back" onClick={() => setSelected(null)}>{t('chat.history.back')}</button><strong>{selected.preview || t('chat.history.noText')}</strong><span>{t('chat.history.readOnly')}</span></div>
          <div className="ac-history-transcript">{reading ? <p className="ac-history-empty">{t('chat.history.loadingBody')}</p> : <MessageList historyPreview view={{ model: null, plan: null, quotas: [], turns, pending: null, notices: [], usage: null, busy: false, background: [], retry: null }} onApprovalDecide={() => undefined} leafId={leafId} />}</div>
          <footer><small>{t('chat.history.limitNote')}</small><div><button type="button" disabled={working} onClick={() => void pin()}>{selected.pinned ? t('chat.history.unpin') : t('chat.history.pin')}</button><button type="button" disabled={working || reading || !canResume || !selected.resumeId || selected.leafId === currentKey} title={!canResume ? t('chat.history.resumeNeedEmpty') : !selected.resumeId ? t('chat.history.resumeNoId') : undefined} onClick={() => { setWorking(true); void onResume(selected).catch(() => setError(t('chat.history.resumeFail'))).finally(() => setWorking(false)) }}>{t('chat.history.resume')}</button></div>{!canResume && <small>{t('chat.history.resumeNeedNew')}</small>}</footer>
        </> : <div className="ac-history-empty">{t('chat.history.pickOne')}<br /><small>{t('chat.history.pickHint')}</small></div>}
      </section>
    </div>
  </div>
}
