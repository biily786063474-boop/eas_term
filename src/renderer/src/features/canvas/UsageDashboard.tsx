import { UsageActivity } from './UsageActivity'
import type { UsageActivitySnapshot } from '../../../../shared/activity'
import { locale, useT } from '../../i18n.ts'
import { rich } from './pluginRich'
import { smoothTrendPath } from './usageTrend'
import { useEffect, useMemo, useState } from 'react'
import type { UsageSnapshot, UsageQuery } from '../../../../shared/usage'
import './usageDashboard.css'
import { UsageMetrics, UsageSessions } from './UsageDetails'
import { UsageProject } from './UsageProject'
import { UsageReceipt } from './UsageReceipt'
import type { ReportPeriod } from './receiptReport'
const fmt=(n:number):string=>Intl.NumberFormat(locale(),{notation:'compact',maximumFractionDigits:2}).format(n)
const time=(n:number):string=>new Date(n).toLocaleString(locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})

export function UsageDashboard({active}:{active:boolean}):JSX.Element {
 const tr=useT()
 const [activity,setActivity]=useState<UsageActivitySnapshot|null>(null),[activityError,setActivityError]=useState('')
 const [report,setReport]=useState<ReportPeriod|null>(null)
 useEffect(()=>{if(!active)setReport(null)},[active])
 const [days,setDays]=useState(7),[page,setPage]=useState(0)
 const [data,setData]=useState<UsageSnapshot|null>(null),[error,setError]=useState(''),[tick,setTick]=useState(0),[point,setPoint]=useState<number|null>(null)
 const range=useMemo<UsageQuery>(()=>{const now=new Date();const from=days===1?new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime():now.getTime()-days*86400000;return {from,to:now.getTime()+1,}},[days,tick])
 const query=useMemo<UsageQuery>(()=>({...range,page}),[range,page])
 useEffect(()=>{
  if(!active)return
  let live=true
  void window.api.usage.query(query).then(d=>{if(live){setData(d);setError('')}}).catch(e=>{if(live)setError(String(e))})
  return ()=>{live=false}
 },[query,active])
 useEffect(()=>{
  if(!active)return
  let live=true
  void window.api.usage.activity().then(d=>{if(live){setActivity(d);setActivityError('')}}).catch(e=>{if(live)setActivityError(String(e))})
  return ()=>{live=false}
 },[active,tick])
 useEffect(()=>{
  if(!active)return
  let id:ReturnType<typeof setInterval>|undefined
  const sync=():void=>{
   if(id!==undefined){clearInterval(id);id=undefined}
   if(document.hidden||!document.hasFocus())return
   setTick(v=>v+1)
   id=setInterval(()=>setTick(v=>v+1),15000)
  }
  sync();document.addEventListener('visibilitychange',sync);window.addEventListener('focus',sync);window.addEventListener('blur',sync)
  return ()=>{if(id!==undefined)clearInterval(id);document.removeEventListener('visibilitychange',sync);window.removeEventListener('focus',sync);window.removeEventListener('blur',sync)}
 },[active])
 const s=data?.summary
 const peak=Math.max(1,...(data?.buckets.map(b=>b.summary.tokens)??[]))
 const x=(i:number):number=>12+i*316/23
 const y=(v:number):number=>108-v/peak*86
 const selected=point!==null?data?.buckets[point]:undefined
 return <div className="ud-panel">
  {report&&active&&<UsageReceipt key={report} period={report} onClose={()=>setReport(null)}/>}
  <div className="ud-top"><div><span className="ud-eyebrow">USAGE OVERVIEW</span><h3>{tr('panels.usage.dashboard')}</h3></div><div className="ud-report-buttons"><button className="ud-report-trigger" onClick={()=>setReport('week')}>{tr('panels.usage.weekly')}</button><button className="ud-report-trigger" onClick={()=>setReport('month')}>{tr('panels.usage.monthly')}</button><button aria-label={tr('panels.usage.refreshUsage')} onClick={()=>setTick(v=>v+1)}>{tr('panels.usage.refresh')}</button></div></div>
  <div className="ud-period">{[[1,tr('panels.usage.today')],[7,tr('panels.usage.last7')],[30,tr('panels.usage.last30')]].map(([n,label])=><button key={n} className={days===n?'on':''} onClick={()=>{setDays(Number(n));setPage(0);setPoint(null)}}>{label}</button>)}</div>
  {(error||data?.error)&&<p className="ud-error" role="alert">{error||data?.error}</p>}
  {!data?<p>{tr('panels.usage.reading')}</p>:<>
   <section className="ud-hero"><span>{tr('panels.usage.heroLabel')}</span><strong>{s!.known?fmt(s!.tokens):'—'}</strong><p>{tr('panels.usage.heroCoverage',{rounds:s!.rounds,known:s!.known,unknown:s!.rounds-s!.known})}</p><UsageMetrics s={s!}/></section>
   <UsageActivity data={activity} error={activityError}/>
   {!s!.rounds&&<div className="ud-empty"><b>{tr('panels.usage.emptyTitle')}</b><p>{tr('panels.usage.emptyDesc')}</p></div>}
   <section className="ud-card"><div className="ud-heading"><b>{tr('panels.usage.trend')}</b><span>{tr('panels.usage.peak',{v:s?.known?fmt(Math.max(0,...data.buckets.map(b=>b.summary.tokens))):'—'})}</span></div>
    <svg viewBox="0 0 340 128" className="ud-chart" aria-label={tr('panels.usage.trendAria')}>
     {[22,65,108].map(v=><line key={v} x1="12" y1={v} x2="328" y2={v} className="ud-grid"/>)}
     <path className="ud-line" d={smoothTrendPath(data.buckets.map((b,i)=>(b.summary.known>0||(b.summary.rounds===0&&b.at>=data.retainedFrom))?{x:x(i),y:y(b.summary.tokens)}:null))}/>
     {data.buckets.map((b,i)=>{
      const known=b.summary.known>0||(b.summary.rounds===0&&b.at>=data.retainedFrom)
      return <g key={i}>
       <circle cx={x(i)} cy={known?y(b.summary.tokens):118} r={point===i?5:3} className={known?'ud-dot':'ud-unknown'} tabIndex={0} role="button" aria-label={tr('panels.usage.pointAria',{time:time(b.at),value:known?tr('panels.usage.tokenAmt',{n:b.summary.tokens}):tr('panels.usage.meterUnknown')})} onFocus={()=>setPoint(i)} onBlur={()=>setPoint(null)} onMouseEnter={()=>setPoint(i)} onMouseLeave={()=>setPoint(null)} onClick={()=>setPoint(i)}><title>{time(b.at)} · {tr('panels.usage.tokenAmt',{n:known?fmt(b.summary.tokens):tr('panels.usage.unknown')})}</title></circle>
      </g>
     })}
    </svg><div className="ud-axis"><span>{time(query.from)}</span><span>{time(query.to)}</span></div>
    <p className="ud-chart-caption">{selected?tr('panels.usage.captionFrom',{time:time(selected.at),rounds:selected.summary.rounds,detail:selected.summary.known?tr('panels.usage.tokensKnownPart',{n:fmt(selected.summary.tokens)}):selected.summary.rounds?tr('panels.usage.notReported'):selected.at<data.retainedFrom?tr('panels.usage.notCollected'):tr('panels.usage.noRequests')}):tr('panels.usage.captionDefault')}</p>
   </section>
   <section className="ud-card"><div className="ud-heading"><b>{tr('panels.usage.projectUsage')}</b><span>{tr('panels.usage.clickToExpand')}</span></div>
    {data.projects.map(p=><UsageProject key={p.path} project={p} maxTokens={Math.max(...data.projects.map(p=>p.summary.tokens),1)} range={range} period={days} active={active} refresh={()=>setTick(v=>v+1)}/>)}
   </section>
   <section className="ud-card"><div className="ud-heading"><b>{tr('panels.usage.distribution')}</b><span>{tr('panels.usage.currentFilter')}</span></div>{data.cli.map(c=><div className="ud-stat" key={c.name}><span>{c.name}</span><b>{tr('panels.usage.tokenAmt',{n:c.summary.known?fmt(c.summary.tokens):tr('panels.usage.unknown')})}</b></div>)}<div className="ud-stat"><span>{tr('panels.usage.avgPerRound')}</span><b>{s!.known?fmt(s!.tokens/s!.known):'—'}</b></div><div className="ud-stat"><span>{tr('panels.usage.maxPerRound')}</span><b>{s!.known?fmt(s!.maxTokens):'—'}</b></div><div className="ud-stat"><span>{tr('panels.usage.interrupted')}</span><b>{tr('panels.usage.roundsUnit',{n:s!.interrupted})}</b></div><div className="ud-stat"><span>{tr('panels.usage.coverage')}</span><b>{s!.rounds?Math.round(s!.known/s!.rounds*100)+'%':'—'}</b></div><div className="ud-stat"><span>{tr('panels.usage.costAttributable')}</span><b>{tr('panels.usage.costRatio',{a:s!.costKnown,b:s!.rounds})}</b></div></section>
   <section className="ud-card"><div className="ud-heading"><b>{tr('panels.usage.stages')}</b><span>{tr('panels.usage.manualOnly')}</span></div>{data.stages.map(c=><div className="ud-stat" key={c.name}><span>{c.name}</span><b>{tr('panels.usage.tokenAmt',{n:c.summary.known?fmt(c.summary.tokens):tr('panels.usage.unknown')})}</b></div>)}</section>
   <section className="ud-card"><UsageSessions data={data} page={page} setPage={setPage} refresh={()=>setTick(v=>v+1)} onError={setError}/></section>
   <button className="ud-export" onClick={()=>void window.api.usage.export(query).then(r=>{if(!r.ok&&!r.cancelled)setError(r.error||tr('panels.usage.exportFail'))}).catch(e=>setError(String(e)))}>{tr('panels.usage.exportCsv')}</button>
   <p className="ud-foot">{rich(tr('panels.usage.footer',{since:time(data.since),retained:time(data.retainedFrom)}))}</p>
  </>}
 </div>
}
