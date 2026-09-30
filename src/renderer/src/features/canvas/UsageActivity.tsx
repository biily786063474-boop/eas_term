import { useState } from 'react'
import type { ActivityKey, UsageActivitySnapshot } from '../../../../shared/activity'
import { locale, useT } from '../../i18n.ts'
import type { I18nKey } from '../../../../shared/i18n/index.ts'
import './usageActivity.css'
const LABEL_KEYS:Record<ActivityKey,I18nKey>={term:'panels.usage.actTerm',canvas:'panels.usage.actCanvas',voice:'panels.usage.actVoice',image:'panels.usage.actImage',island:'panels.usage.actIsland',approve:'panels.usage.actApprove',view:'panels.usage.actView',agent:'panels.usage.actAgent',chat:'panels.usage.actChat'}
const fmt=(n:number):string=>Intl.NumberFormat(locale(),{notation:'compact',maximumFractionDigits:1}).format(n)
export function UsageActivity({data,error}:{data:UsageActivitySnapshot|null;error:string}):JSX.Element {
 const tr=useT()
 const [mode,setMode]=useState<'token'|'activity'>('token')
 const [selected,setSelected]=useState<number|null>(null)
 const [more,setMore]=useState(false)
 if(!data)return <section className="ud-card"><b>{tr('panels.usage.heatmap')}</b><p className={error?'ud-error':'ud-foot'}>{error||tr('panels.usage.readingActivity')}</p></section>
 const value=(d:UsageActivitySnapshot['days'][number]):number|null=>mode==='token'?d.tokens:d.actions
 const peak=Math.max(1,...data.days.map(d=>value(d)??0))
 const first=new Date(data.days[0].date+'T12:00:00'),padding=(first.getDay()+6)%7
 const columns=Math.ceil((padding+data.days.length)/7)
 const active=selected===null?null:data.days[selected]
 const amount=(n:number,raw=false):string=>tr(mode==='token'?'panels.usage.tokenAmt':'panels.usage.actionAmt',{n:raw?n:fmt(n)})
 const detail=active?active.date+' · '+(value(active)===null?tr('panels.usage.unrecorded'):amount(value(active)!))+(mode==='token'?' · '+(active.rounds===null?tr('panels.usage.roundsUnrecorded'):tr('panels.usage.roundsN',{n:active.rounds})):'')+((mode==='token'?active.tokenPartial:active.activityPartial)?' · '+tr('panels.usage.partial'):''):tr('panels.usage.hoverHint')
 const knownActivity=data.days.some(d=>d.actions!==null)
 const featureRows=data.features.filter(f=>f.count>0)
 const counts=[[tr('panels.usage.activeDays'),data.activeDays],[tr('panels.usage.currentStreak'),data.currentStreak],[tr('panels.usage.longestStreak'),data.longestStreak]] as const
 return <>
  <section className="ud-card ua-card" aria-label={tr('panels.usage.heatmap')}>
   <div className="ud-heading"><b>{tr('panels.usage.heatmap')}</b><span>{tr('panels.usage.last90Local')}</span></div>
   <div className="ua-tabs" role="group" aria-label={tr('panels.usage.basis')}>{([['token','Token'],['activity',tr('panels.usage.appActivity')]] as const).map(([key,label])=><button key={key} aria-pressed={mode===key} className={mode===key?'on':''} onClick={()=>{setMode(key);setSelected(null)}}>{label}</button>)}</div>
   <div className="ua-calendar"><div className="ua-weekdays" aria-hidden="true"><span>{tr('panels.usage.wdMon')}</span><span>{tr('panels.usage.wdWed')}</span><span>{tr('panels.usage.wdFri')}</span><span>{tr('panels.usage.wdSun')}</span></div><div className="ua-grid" style={{gridTemplateColumns:'repeat('+columns+', minmax(0,1fr))'}}>
    {Array.from({length:padding},(_,i)=><i key={'pad'+i}/>)}
    {data.days.map((d,i)=>{const v=value(d),level=v===null?-1:v===0?0:Math.min(4,Math.max(1,Math.ceil(Math.sqrt(v/peak)*4)))
     const val=v===null?tr('panels.usage.unrecorded'):amount(v,true)
     const label=(mode==='token'?d.tokenPartial:d.activityPartial)?tr('panels.usage.cellAriaPartial',{date:d.date,value:val}):tr('panels.usage.cellAria',{date:d.date,value:val})
     return <button key={d.date} className={'ua-cell ua-level-'+level} aria-label={label} onMouseEnter={()=>setSelected(i)} onMouseLeave={()=>setSelected(null)} onFocus={()=>setSelected(i)} onBlur={()=>setSelected(null)} onClick={()=>setSelected(i)} />})}
   </div></div>
   <div className="ua-axis"><span>{data.days[0].date.slice(5).replace('-',' / ')}</span><span>{data.days.at(-1)!.date.slice(5).replace('-',' / ')}</span></div>
   <div className="ua-legend"><span>{tr('panels.usage.unrecorded')}</span><i className="ua-level--1"/><span>{tr('panels.usage.less')}</span>{[0,1,2,3,4].map(v=><i key={v} className={'ua-level-'+v}/>)}<span>{tr('panels.usage.more')}</span></div>
   <p className="ua-detail" role="status">{detail}</p>
  </section>
  <section className="ud-card ua-behavior" aria-label={tr('panels.usage.behaviorAria')}>
   <div className="ud-heading"><b>{tr('panels.usage.behavior')}</b><span>{tr('panels.usage.behaviorSub')}</span></div>
   {(error||data.error)&&<p className="ud-error" role="alert">{error||data.error}</p>}
   <div className="ua-metrics">{counts.map(([label,n])=><div key={label}><span>{label}</span><strong>{knownActivity?n:'—'}<small>{tr('panels.usage.daysUnit')}</small></strong></div>)}</div>
   <div className="ud-stat"><span>{tr('panels.usage.sessionsWithReq')}</span><b>{data.sessions===null?'—':tr('panels.usage.countUnit',{n:data.sessions})}</b></div><div className="ud-stat"><span>{tr('panels.usage.projectsWithReq')}</span><b>{data.projects===null?'—':tr('panels.usage.countUnit',{n:data.projects})}</b></div>
   <h4>{tr('panels.usage.topFeatures')}</h4>
   {!featureRows.length?<p className="ud-foot">{data.activityAvailable?tr('panels.usage.noFeatureRecords'):tr('panels.usage.behaviorUnreadable')}</p>:featureRows.slice(0,more?undefined:4).map(f=><div className="ud-stat" key={f.key}><span>{tr(LABEL_KEYS[f.key])}</span><b>{tr('panels.usage.timesN',{n:fmt(f.count)})}</b></div>)}
   {featureRows.length>4&&<button className="ua-more" aria-expanded={more} onClick={()=>setMore(!more)}>{more?tr('panels.usage.collapse'):tr('panels.usage.showAll')}</button>}
   <h4>{tr('panels.usage.topPlugins')}</h4>
   {!data.plugins.length?<p className="ud-foot">{data.activityAvailable?tr('panels.usage.noPluginRecords'):tr('panels.usage.pluginUnreadable')}</p>:data.plugins.slice(0,5).map(p=><div className="ud-stat" key={p.id}><span>{p.id}</span><b>{tr('panels.usage.pluginUse',{opens:fmt(p.opens),calls:fmt(p.calls)})}</b></div>)}
   <details className="ua-method"><summary>{tr('panels.usage.methodTitle')}</summary><p>{tr('panels.usage.method1')}</p><p>{tr('panels.usage.method2')}</p><p>{tr('panels.usage.method3',{since:data.activityAvailable?new Date(data.since).toLocaleString(locale()):tr('panels.usage.unreadable'),tokenSince:data.tokenAvailable?new Date(data.tokenSince).toLocaleString(locale()):tr('panels.usage.unreadable')})}</p><p>{tr('panels.usage.method4')}</p></details>
  </section>
 </>
}
