import { useEffect, useId, useState } from 'react'
import type { UsageQuery, UsageSnapshot } from '../../../../shared/usage'
import { UsageMetrics, UsageSessions } from './UsageDetails'
import { smoothTrendPath } from './usageTrend'

const fmt=(n:number):string=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(n)

/** Only mounted for expanded projects. No extra timers or global filter state. */
function ProjectDetails({path,range,active,refresh}:{path:string;range:UsageQuery;active:boolean;refresh:()=>void}):JSX.Element {
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
  {(error||data?.error)&&<p className="ud-error" role="alert">{error||data?.error} <button onClick={()=>setRetry(v=>v+1)}>重试</button></p>}
  {!data?(!error&&<p role="status">正在读取项目明细…</p>):<>
   <UsageMetrics s={data.summary}/>
   <p className="ud-project-coverage">{data.summary.rounds} 轮请求 · {data.summary.known} 轮有计量 · 费用已知 {data.summary.costKnown} / {data.summary.rounds} 轮</p>
   {!data.matched&&<p>这一期间暂无请求记录。</p>}
   <UsageSessions data={data} page={page} setPage={setPage} refresh={refresh} onError={setError}/>
  </>}
 </>
}

export function UsageProject({project,maxTokens,range,period,active,refresh}:{
 project:UsageSnapshot['projects'][number];maxTokens:number;range:UsageQuery;period:number;active:boolean;refresh:()=>void
}):JSX.Element {
 const [expanded,setExpanded]=useState(false)
 const id=useId()
 const peak=Math.max(1,...project.trend.map(v=>v??0))
 return <div className="ud-project-item">
  <button type="button" title={project.path} className={'ud-project'+(expanded?' selected':'')} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>
   <span className="ud-project-name"><span aria-hidden="true" className="ud-project-chevron">{expanded?'▾':'▸'}</span>{project.name}<small>{project.summary.rounds} 轮 · {project.summary.known} 轮有计量</small></span>
   <b>{project.summary.known?fmt(project.summary.tokens):'未知'}</b>
   <svg viewBox="0 0 316 40" className="ud-project-trend" aria-label={project.name+'时间趋势'}><path className="ud-line" d={smoothTrendPath(project.trend.map((v,i)=>v===null?null:{x:i*316/23,y:36-v/peak*30}))}/></svg>
   <i style={{width:Math.min(100,project.summary.tokens/maxTokens*100)+'%'}}/>
  </button>
  <div id={id} hidden={!expanded}>
   {expanded&&<div className="ud-project-details" data-project={project.path} role="region" aria-label={project.name+'用量详情'}>
    <ProjectDetails key={period} path={project.path} range={range} active={active} refresh={refresh}/>
   </div>}
  </div>
 </div>
}
