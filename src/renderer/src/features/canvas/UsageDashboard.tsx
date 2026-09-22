import { smoothTrendPath } from './usageTrend'
import { useEffect, useMemo, useState } from 'react'
import type { UsageSnapshot, UsageQuery } from '../../../../shared/usage'
import './usageDashboard.css'
import { UsageMetrics, UsageSessions } from './UsageDetails'
import { UsageProject } from './UsageProject'
import { UsageReceipt } from './UsageReceipt'
import type { ReportPeriod } from './receiptReport'
const fmt=(n:number):string=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(n)
const time=(n:number):string=>new Date(n).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})

export function UsageDashboard({active}:{active:boolean}):JSX.Element {
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
  <div className="ud-top"><div><span className="ud-eyebrow">USAGE OVERVIEW</span><h3>用量仪表盘</h3></div><div className="ud-report-buttons"><button className="ud-report-trigger" onClick={()=>setReport('week')}>周报</button><button className="ud-report-trigger" onClick={()=>setReport('month')}>月报</button><button aria-label="刷新用量" onClick={()=>setTick(v=>v+1)}>刷新</button></div></div>
  <div className="ud-period">{[[1,'今天'],[7,'近 7 天'],[30,'近 30 天']].map(([n,label])=><button key={n} className={days===n?'on':''} onClick={()=>{setDays(Number(n));setPage(0);setPoint(null)}}>{label}</button>)}</div>
  {(error||data?.error)&&<p className="ud-error" role="alert">{error||data?.error}</p>}
  {!data?<p>正在读取本地用量…</p>:<>
   <section className="ud-hero"><span>全部项目 · 已记录 Token</span><strong>{s!.known?fmt(s!.tokens):'—'}</strong><p>{s!.rounds} 轮请求 · {s!.known} 轮有计量 · {s!.rounds-s!.known} 轮未知或进行中</p><UsageMetrics s={s!}/></section>
   {!s!.rounds&&<div className="ud-empty"><b>还没有这一期间的记录</b><p>从此版本开始采集 AI 对话用量。历史聊天不会被重发或扫描记账。</p></div>}
   <section className="ud-card"><div className="ud-heading"><b>整体用量趋势</b><span>峰值 {s?.known?fmt(Math.max(0,...data.buckets.map(b=>b.summary.tokens))):'—'} Token / 区间</span></div>
    <svg viewBox="0 0 340 128" className="ud-chart" aria-label="用量时间趋势，使用 Tab 查看各时间区间">
     {[22,65,108].map(v=><line key={v} x1="12" y1={v} x2="328" y2={v} className="ud-grid"/>)}
     <path className="ud-line" d={smoothTrendPath(data.buckets.map((b,i)=>(b.summary.known>0||(b.summary.rounds===0&&b.at>=data.retainedFrom))?{x:x(i),y:y(b.summary.tokens)}:null))}/>
     {data.buckets.map((b,i)=>{
      const known=b.summary.known>0||(b.summary.rounds===0&&b.at>=data.retainedFrom)
      return <g key={i}>
       <circle cx={x(i)} cy={known?y(b.summary.tokens):118} r={point===i?5:3} className={known?'ud-dot':'ud-unknown'} tabIndex={0} role="button" aria-label={time(b.at)+'，'+(known?b.summary.tokens+' Token':'计量未知')} onFocus={()=>setPoint(i)} onBlur={()=>setPoint(null)} onMouseEnter={()=>setPoint(i)} onMouseLeave={()=>setPoint(null)} onClick={()=>setPoint(i)}><title>{time(b.at)} · {known?fmt(b.summary.tokens):'未知'} Token</title></circle>
      </g>
     })}
    </svg><div className="ud-axis"><span>{time(query.from)}</span><span>{time(query.to)}</span></div>
    <p className="ud-chart-caption">{selected?time(selected.at)+' 起 · '+selected.summary.rounds+' 轮 · '+(selected.summary.known?fmt(selected.summary.tokens)+' Token（已知部分）':selected.summary.rounds?'用量未上报':selected.at<data.retainedFrom?'未采集区间':'无请求'):'24 个等时区间；圆点可悬停/聚焦，未知区间断线，不补零。'}</p>
   </section>
   <section className="ud-card"><div className="ud-heading"><b>项目用量</b><span>点击项目展开详情</span></div>
    {data.projects.map(p=><UsageProject key={p.path} project={p} maxTokens={Math.max(...data.projects.map(p=>p.summary.tokens),1)} range={range} period={days} active={active} refresh={()=>setTick(v=>v+1)}/>)}
   </section>
   <section className="ud-card"><div className="ud-heading"><b>消耗分布</b><span>当前筛选范围</span></div>{data.cli.map(c=><div className="ud-stat" key={c.name}><span>{c.name}</span><b>{c.summary.known?fmt(c.summary.tokens):'未知'} Token</b></div>)}<div className="ud-stat"><span>平均每轮 · 仅有计量</span><b>{s!.known?fmt(s!.tokens/s!.known):'—'}</b></div><div className="ud-stat"><span>单轮峰值</span><b>{s!.known?fmt(s!.maxTokens):'—'}</b></div><div className="ud-stat"><span>已中断请求</span><b>{s!.interrupted} 轮</b></div><div className="ud-stat"><span>Token 计量覆盖率</span><b>{s!.rounds?Math.round(s!.known/s!.rounds*100)+'%':'—'}</b></div><div className="ud-stat"><span>费用可归属</span><b>{s!.costKnown} / {s!.rounds} 轮</b></div></section>
   <section className="ud-card"><div className="ud-heading"><b>任务阶段</b><span>仅使用手动标签</span></div>{data.stages.map(c=><div className="ud-stat" key={c.name}><span>{c.name}</span><b>{c.summary.known?fmt(c.summary.tokens):'未知'} Token</b></div>)}</section>
   <section className="ud-card"><UsageSessions data={data} page={page} setPage={setPage} refresh={()=>setTick(v=>v+1)} onError={setError}/></section>
   <button className="ud-export" onClick={()=>void window.api.usage.export(query).then(r=>{if(!r.ok&&!r.cancelled)setError(r.error||'导出失败')}).catch(e=>setError(String(e)))}>导出当前筛选明细 CSV</button>
   <p className="ud-foot">采集起点：{time(data.since)}<br/>保留边界：{time(data.retainedFrom)} · 最多 90 天 / 50,000 轮。<br/>仅统计 Eas-Term AI 对话；未采集的历史、外部终端和缺失值不算 0。输入含上下文，并非只算本轮文字。输入包含缓存读写；OMP 优先用上报总量减输出还原总输入。<br/>费用仅含 Claude 同一进程连续累计值的差额；首次、跨进程、缺报区间及其他 CLI 的费用未知。这不是供应商账单。</p>
  </>}
 </div>
}
