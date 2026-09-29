import { useEffect, useId, useState } from 'react'
import type { UsageQuery, UsageSnapshot } from '../../../../shared/usage'
import { locale, useT } from '../../i18n.ts'
import { UsageMetrics, UsageSessions } from './UsageDetails'
import { smoothTrendPath } from './usageTrend'

const fmt=(n:number):string=>Intl.NumberFormat(locale(),{notation:'compact',maximumFractionDigits:2}).format(n)

/** Only mounted for expanded projects. No extra timers or global filter state. */
function ProjectDetails({path,range,active,refresh}:{path:string;range:UsageQuery;active:boolean;refresh:()=>void}):JSX.Element {
 const tr=useT()
 const [page,setPage]=useState(0)
 const [result,setResult]=useState<{page:number;data:UsageSnapshot}|null>(null)
 const [error,setError]=useState('')
 const [retry,setRetry]=useState(0)
 const {from,to}=range
 useEffect(()=>{
  if(!active)return
  let live=true
  setError('')
  void window.api.usage.query({from,to,project:path,page}).then(data=>{
   if(live)setResult({page,data})
  }).catch(e=>{if(live)setError(String(e))})
  return ()=>{live=false}
 },[path,from,to,page,active,retry])
 const data=result?.page===page?result.data:null
 return <>
  {(error||data?.error)&&<p className="ud-error" role="alert">{error||data?.error} <button onClick={()=>setRetry(v=>v+1)}>{tr('panels.usage.retry')}</button></p>}
  {!data?(!error&&<p role="status">{tr('panels.usage.readingProject')}</p>):<>
   <UsageMetrics s={data.summary}/>
   <p className="ud-project-coverage">{tr('panels.usage.projectCoverage',{rounds:data.summary.rounds,known:data.summary.known,costKnown:data.summary.costKnown})}</p>
   {!data.matched&&<p>{tr('panels.usage.noRequestsPeriod')}</p>}
   <UsageSessions data={data} page={page} setPage={setPage} refresh={refresh} onError={setError}/>
  </>}
 </>
}

export function UsageProject({project,maxTokens,range,period,active,refresh}:{
 project:UsageSnapshot['projects'][number];maxTokens:number;range:UsageQuery;period:number;active:boolean;refresh:()=>void
}):JSX.Element {
 const tr=useT()
 const [expanded,setExpanded]=useState(false)
 const id=useId()
 const peak=Math.max(1,...project.trend.map(v=>v??0))
 return <div className="ud-project-item">
  <button type="button" title={project.path} className={'ud-project'+(expanded?' selected':'')} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>
   <span className="ud-project-name"><span aria-hidden="true" className="ud-project-chevron">{expanded?'▾':'▸'}</span>{project.name}<small>{tr('panels.usage.projectRounds',{rounds:project.summary.rounds,known:project.summary.known})}</small></span>
   <b>{project.summary.known?fmt(project.summary.tokens):tr('panels.usage.unknown')}</b>
   <svg viewBox="0 0 316 40" className="ud-project-trend" aria-label={tr('panels.usage.projectTrendAria',{name:project.name})}><path className="ud-line" d={smoothTrendPath(project.trend.map((v,i)=>v===null?null:{x:i*316/23,y:36-v/peak*30}))}/></svg>
   <i style={{width:Math.min(100,project.summary.tokens/maxTokens*100)+'%'}}/>
  </button>
  <div id={id} hidden={!expanded}>
   {expanded&&<div className="ud-project-details" data-project={project.path} role="region" aria-label={tr('panels.usage.projectDetailAria',{name:project.name})}>
    <ProjectDetails key={period} path={project.path} range={range} active={active} refresh={refresh}/>
   </div>}
  </div>
 </div>
}
