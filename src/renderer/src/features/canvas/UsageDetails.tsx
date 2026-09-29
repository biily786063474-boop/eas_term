import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { locale, useT } from '../../i18n.ts'
import { rich } from './pluginRich'
import type { UsageSnapshot, UsageSummary, UsageRow } from '../../../../shared/usage'
const fmt=(n:number):string=>Intl.NumberFormat(locale(),{notation:'compact',maximumFractionDigits:2}).format(n)
const time=(n:number):string=>new Date(n).toLocaleString(locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})

/** Measure actual wrapped rows rather than guessing heights from font sizes. */
function ThreeRowScroll({kind,children}:{kind:'sessions'|'rounds';children:ReactNode}):JSX.Element {
 const tr=useT()
 const ref=useRef<HTMLDivElement>(null)
 useLayoutEffect(()=>{
  const box=ref.current
  if(!box)return
  const items=Array.from(box.children).slice(0,3) as HTMLElement[]
  const measure=():void=>{
   const heights=items.map(item=>{
    const summary=item.querySelector('summary')
    if(!summary||!summary.getBoundingClientRect().height)return 0
    const css=getComputedStyle(item)
    const px=(value:string):number=>parseFloat(value)||0
    const margins=px(css.marginTop)+px(css.marginBottom)
    // Expanding a round must not stretch the viewport to the full detail height.
    return kind==='rounds'
     ? summary.getBoundingClientRect().height+margins+px(css.paddingTop)+px(css.paddingBottom)+px(css.borderTopWidth)+px(css.borderBottomWidth)
     : item.getBoundingClientRect().height+margins
   })
   if(!heights.length||heights.some(h=>!h))return
   // max-height only: shorter lists do not reserve three empty rows.
   const height=Math.ceil(heights.reduce((a,b)=>a+b,0)*3/heights.length)+'px'
   if(box.style.maxHeight!==height)box.style.maxHeight=height
  }
  measure()
  const observer=new ResizeObserver(measure)
  observer.observe(box)
  for(const item of items){observer.observe(item);const summary=item.querySelector('summary');if(summary)observer.observe(summary)}
  return ()=>observer.disconnect()
 },[children,kind])
 return <div ref={ref} className={'ud-three-scroll ud-'+kind+'-scroll'} tabIndex={0} role="region" aria-label={kind==='sessions'?tr('panels.usage.sessionListAria'):tr('panels.usage.roundListAria')}>{children}</div>
}

function Round({row,refresh,onError}:{row:UsageRow;refresh:()=>void;onError:(s:string)=>void}):JSX.Element {
 const tr=useT()
 const unreported=tr('panels.usage.unreported'),unknown=tr('panels.usage.unknown')
 const [stage,setStage]=useState(row.stage??'')
 const [busy,setBusy]=useState(false)
 return <details className="ud-round" data-usage-row={row.id}><summary><span>{time(row.startedAt)} · {row.cli}</span><b>{row.meter?fmt(row.meter.input+row.meter.output):unknown} <small>token</small></b></summary>
  <p>{row.model} · {row.status==='running'?tr('panels.usage.running'):row.status==='interrupted'?tr('panels.usage.interruptedShort'):tr('panels.usage.finished')}</p>
  <p>{rich(tr('panels.usage.roundDetail',{input:row.meter?.input.toLocaleString()??unreported,output:row.meter?.output.toLocaleString()??unreported,cacheRead:row.meter?.cacheRead?.toLocaleString()??unreported,cacheWrite:row.meter?.cacheWrite?.toLocaleString()??unreported,cost:row.costUsd===undefined?unknown:'$'+row.costUsd.toFixed(5)}))}</p>
  <form onSubmit={e=>{e.preventDefault();setBusy(true);void window.api.usage.stage(row.id,stage).then(refresh).catch(e=>onError(String(e))).finally(()=>setBusy(false))}}>
   <input aria-label={tr('panels.usage.stage')} placeholder={tr('panels.usage.stagePh')} maxLength={60} value={stage} onChange={e=>setStage(e.target.value)}/><button disabled={busy}>{tr('panels.common.save')}</button>
  </form>
 </details>
}
export function UsageMetrics({s}:{s:UsageSummary}):JSX.Element {
 const tr=useT()
 return <div className="ud-metrics"><div>{tr('panels.usage.input')}<b>{s.known?fmt(s.input):'—'}</b></div><div>{tr('panels.usage.output')}<b>{s.known?fmt(s.output):'—'}</b></div><div>{tr('panels.usage.cacheRead')}<b>{s.cacheKnown?fmt(s.cacheRead):'—'}</b></div><div>{tr('panels.usage.cacheWrite')}<b>{s.cacheWriteKnown?fmt(s.cacheWrite):'—'}</b></div><div>{tr('panels.usage.knownCost')}<b>{s.costKnown?'$'+s.costUsd.toFixed(3):tr('panels.usage.unknown')}</b></div></div>
}

export function UsageSessions({data,page,setPage,refresh,onError}:{data:UsageSnapshot;page:number;setPage:(p:number)=>void;refresh:()=>void;onError:(s:string)=>void}):JSX.Element {
 const tr=useT()
 const sessions=new Map<string,UsageRow[]>()
 for(const row of data.rows){const rows=sessions.get(row.session)??[];rows.push(row);sessions.set(row.session,rows)}
 return <details className="ud-session-list"><summary className="ud-heading"><b>{tr('panels.usage.sessionsToRounds')}</b><span>{tr('panels.usage.totalRounds',{n:data.matched})}</span></summary><ThreeRowScroll key={page} kind="sessions">{[...sessions].map(([id,rows])=><details key={id} className="ud-session"><summary>{tr('panels.usage.sessionN',{id:id.slice(0,12)})} <small>{tr('panels.usage.sessionMeta',{page:rows.length,total:data.sessions.find(s=>s.id===id)?.summary.rounds??'',tokens:tr('panels.usage.tokensKnownPart',{n:data.sessions.find(s=>s.id===id)?.summary.known?fmt(data.sessions.find(s=>s.id===id)!.summary.tokens):tr('panels.usage.unknown')})})}</small></summary><ThreeRowScroll kind="rounds">{rows.map(row=><Round key={row.id} row={row} refresh={refresh} onError={onError}/>)}</ThreeRowScroll></details>)}</ThreeRowScroll><div className="ud-pagination"><button disabled={!page} onClick={()=>setPage(page-1)}>{tr('panels.usage.prevPage')}</button><span>{page+1} / {Math.max(1,Math.ceil(data.matched/100))}</span><button disabled={(page+1)*100>=data.matched} onClick={()=>setPage(page+1)}>{tr('panels.usage.nextPage')}</button></div></details>
}
