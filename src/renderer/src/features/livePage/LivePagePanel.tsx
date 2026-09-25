import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LivePageState } from '../../../../shared/livePage'
import { useLivePages } from './livePageStore'
import './livePage.css'

function PageContent({ state }: { state: LivePageState }): JSX.Element {
  return <div className="live-page-surface">
    {state.frame ? <img src={state.frame} alt="开发页面实时预览" draggable={false} /> : <div className="live-page-wait">{state.error || '等待开发页面画面…'}</div>}
    {state.loading && <div className="live-page-loading"><span />正在加载页面</div>}
    {state.error && state.frame && <div className="live-page-error">{state.error}</div>}
  </div>
}

function PageHeader({ state }: { state: LivePageState }): JSX.Element {
  return <header className="live-page-header">
    <span className="live-page-dot" />
    <div className="live-page-titles"><strong>{state.title || '页面开发'}</strong><small title={state.url}>{state.url || '本地开发服务器'}</small></div>
    <button title="在独立窗口中打开" aria-label="在独立窗口中打开" onClick={() => void window.api.livePage.popout(state.owner)}>↗</button>
    <button title="收起预览" aria-label="收起预览" onClick={() => void window.api.livePage.visible(state.owner, false)}>−</button>
    <button title="结束页面观察" aria-label="结束页面观察" onClick={() => void window.api.livePage.close(state.owner)}>×</button>
  </header>
}

function Reopen({ state }: { state: LivePageState }): JSX.Element {
  return <button className="live-page-reopen" onClick={() => void (state.popout ? window.api.livePage.dock(state.owner) : window.api.livePage.visible(state.owner, true))}>{state.popout ? '返回内嵌预览 ↙' : '打开页面预览 ↗'}</button>
}

export function LivePageSplitDrawer({ active }: { active: boolean }): JSX.Element {
  const states = useLivePages()
  const state = [...states].reverse().find((item) => item.url || item.loading)
  const open = active && !!state && state.visible && !state.popout
  return <>
    <aside className={'live-page-drawer' + (open ? ' is-open' : '')} aria-hidden={!open}>
      {state && <><PageHeader state={state} /><PageContent state={state} /></>}
    </aside>
    {active && state && !open && <Reopen state={state} />}
  </>
}

export function LivePageChatHost({ leafId, inline, children }: { leafId: string; inline: boolean; children: ReactNode }): JSX.Element {
  const states = useLivePages()
  const state = [...states].reverse().find((item) => item.leafId === leafId)
  const open = inline && !!state && state.visible && !state.popout
  const host = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!inline || !host.current) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= 620))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [inline])
  return <div ref={host} className={'live-page-chat-host' + (open ? ' has-live-page' : '') + (narrow ? ' is-narrow' : '')}>
    <div className="live-page-chat-content">{children}</div>
    <aside className="live-page-inline" aria-hidden={!open}>
      {state && <><PageHeader state={state} /><PageContent state={state} /></>}
    </aside>
    {inline && state && !open && <Reopen state={state} />}
  </div>
}
