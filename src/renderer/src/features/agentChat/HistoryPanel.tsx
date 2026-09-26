import { useEffect, useRef, useState } from 'react'
import type { HistorySummary } from '../../../../shared/historyCatalog'
import type { Turn } from './reduce'
import { MessageList } from './MessageList'
import { settleOnLoad } from './history'
import { CloseIcon, MessageIcon } from '../../ui/Icons'
import './historyPanel.css'

/** Reading history never sends a prompt or starts a CLI. */
export function HistoryPanel({ cwd, moduleId, currentKey, leafId, onClose, onResume, canResume }: {
  cwd: string; moduleId: string; currentKey: string; leafId: string
  onClose: () => void; onResume: (h: HistorySummary) => Promise<void>; canResume: boolean
}): JSX.Element {
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
      }).catch(() => { if (alive) { setError('历史读取失败，请重试'); setLoading(false) } })
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
    }).catch(() => { if (alive) { setError('这段记录暂时无法读取'); setReading(false) } })
    return () => { alive = false }
  }, [selected?.leafId])
  const visible = items.filter(h => scope === 'project' || (scope === 'pinned' ? h.pinned : h.moduleId === moduleId || h.leafId === moduleId || h.leafId === currentKey))
  const pin = async (): Promise<void> => {
    if (!selected || working) return
    setWorking(true)
    try {
      if (!await window.api.agentChat.pinHistory(selected.leafId, cwd, !selected.pinned)) throw new Error()
      setSelected({ ...selected, pinned: !selected.pinned }); setRevision(x => x + 1)
    } catch { setError('置顶保存失败，请重试') } finally { setWorking(false) }
  }
  return <div className={'ac-history-panel' + (selected ? ' has-detail' : '')} ref={root} role="region" aria-label="历史对话" onPointerDown={e => e.stopPropagation()}>
    <header className="ac-history-head"><div><strong>历史对话</strong><small>保留记录，随时回到之前</small></div><button type="button" aria-label="关闭历史对话" onClick={onClose}><CloseIcon size={15} /></button></header>
    <div className="ac-history-filters">
      <nav aria-label="历史范围">{([['module','本模块'],['project','本项目'],['pinned','置顶']] as const).map(([id,label]) => <button key={id} type="button" aria-pressed={scope === id} onClick={() => { setScope(id); setSelected(null) }}>{label}</button>)}</nav>
      <input ref={search} aria-label="搜索历史对话" placeholder="搜索对话内容…" value={query} onChange={e => { setQuery(e.target.value); setSelected(null) }} />
    </div>
    {error && <div className="ac-history-error" role="alert">{error}<button type="button" onClick={() => { setError(''); setRevision(x => x + 1) }}>重试</button></div>}
    <div className="ac-history-body">
      <div className="ac-history-list">
        {loading ? <p className="ac-history-empty">正在读取…</p> : visible.length ? visible.map(h => <button type="button" key={h.leafId} className={selected?.leafId === h.leafId ? 'selected' : ''} onClick={() => setSelected(h)}>
          <span className="ac-history-title"><MessageIcon size={13} /><span>{h.preview || '无文字对话'}</span>{h.pinned && <small>置顶</small>}</span>
          <small>{new Date(h.savedAt).toLocaleDateString()} · {h.turns} 条记录{h.leafId === currentKey ? ' · 当前' : ''}</small>
        </button>) : <p className="ac-history-empty">{query ? '没有匹配的对话' : scope === 'module' ? '暂无本模块记录；早期记录可在「本项目」找回' : scope === 'pinned' ? '还没有置顶对话' : '发送消息后，记录会出现在这里'}</p>}
      </div>
      <section className="ac-history-detail" aria-label="对话预览">
        {selected ? <>
          <div className="ac-history-detail-head"><button type="button" className="ac-history-back" onClick={() => setSelected(null)}>‹ 返回列表</button><strong>{selected.preview || '无文字对话'}</strong><span>只读预览 · 不启动 AI</span></div>
          <div className="ac-history-transcript">{reading ? <p className="ac-history-empty">正在读取正文…</p> : <MessageList historyPreview view={{ model: null, plan: null, quotas: [], turns, pending: null, notices: [], usage: null, busy: false, retry: null }} onApprovalDecide={() => undefined} leafId={leafId} />}</div>
          <footer><small>这里只加载最近 100 条，完整记录已保存在本机；预览不代表模型仍保有上下文。</small><div><button type="button" disabled={working} onClick={() => void pin()}>{selected.pinned ? '取消置顶' : '置顶'}</button><button type="button" disabled={working || reading || !canResume || !selected.resumeId || selected.leafId === currentKey} title={!canResume ? '请先保存并新建一个空对话，再选择历史' : !selected.resumeId ? '缺少原会话标识，仅可查看记录' : undefined} onClick={() => { setWorking(true); void onResume(selected).catch(() => setError('恢复失败，原记录未删除')).finally(() => setWorking(false)) }}>继续此对话</button></div>{!canResume && <small>当前模块有对话，请先新建后再恢复。</small>}</footer>
        </> : <div className="ac-history-empty">选择一段对话<br /><small>先看看，再决定是否继续</small></div>}
      </section>
    </div>
  </div>
}
