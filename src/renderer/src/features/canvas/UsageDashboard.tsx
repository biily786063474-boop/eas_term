import { useEffect, useMemo, useState } from 'react'
import type { UsageSnapshot, UsageQuery, UsageRow } from '../../../../shared/usage'
import './usageDashboard.css'
const fmt=(n:number):string=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(n)
const time=(n:number):string=>new Date(n).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})

function Round({row,refresh,onError}:{row:UsageRow;refresh:()=>void;onError:(s:string)=>void}):JSX.Element {
 const [stage,setStage]=useState(row.stage??'')
 const [busy,setBusy]=useState(false)
 return <details className="ud-round"><summary><span>{time(row.startedAt)} · {row.cli}</span><b>{row.meter?fmt(row.meter.input+row.meter.output):'未知'} <small>token</small></b></summary>
  <p>{row.model} · {row.status==='running'?'进行中':row.status==='interrupted'?'已中断':'已结束'}</p>
  <p>输入 {row.meter?.input.toLocaleString()??'未上报'} · 输出 {row.meter?.output.toLocaleString()??'未上报'}<br/>缓存读 {row.meter?.cacheRead?.toLocaleString()??'未上报'} · 缓存写 {row.meter?.cacheWrite?.toLocaleString()??'未上报'}<br/>费用 {row.costUsd===undefined?'未知':'$'+row.costUsd.toFixed(5)}</p>
  <form onSubmit={e=>{e.preventDefault();setBusy(true);void window.api.usage.stage(row.id,stage).then(refresh).catch(e=>onError(String(e))).finally(()=>setBusy(false))}}>
   <input aria-label="任务阶段" placeholder="手动标记阶段，如：回归测试" maxLength={60} value={stage} onChange={e=>setStage(e.target.value)}/><button disabled={busy}>保存</button>
  </form>
 </details>
}
export function UsageDashboard({active}:{active:boolean}):JSX.Element {
 const [days,setDays]=useState(7),[project,setProject]=useState(''),[page,setPage]=useState(0)
 const [data,setData]=useState<UsageSnapshot|null>(null),[error,setError]=useState(''),[tick,setTick]=useState(0),[point,setPoint]=useState<number|null>(null)
 const query=useMemo<UsageQuery>(()=>{const now=new Date();const from=days===1?new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime():now.getTime()-days*86400000;return {from,to:now.getTime()+1,project:project||undefined,page}},[days,project,page,tick])
 useEffect(()=>{
  if(!active)return
  let live=true
  void window.api.usage.query(query).then(d=>{if(live){setData(d);setError('')}}).catch(e=>{if(live)setError(String(e))})
  return ()=>{live=false}
 },[query,active])
 useEffect(()=>{if(!active)return;const id=setInterval(()=>setTick(v=>v+1),15000);return ()=>clearInterval(id)},[active])
 const select=(p:string):void=>{setProject(p);setPage(0);setPoint(null)}
 const s=data?.summary
 const sessions=new Map<string,UsageRow[]>()
 for(const row of data?.rows??[]){const rows=sessions.get(row.session)??[];rows.push(row);sessions.set(row.session,rows)}
 const peak=Math.max(1,...(data?.buckets.map(b=>b.summary.tokens)??[]))
 const x=(i:number):number=>12+i*316/23
 const y=(v:number):number=>108-v/peak*86
 const selected=point!==null?data?.buckets[point]:undefined
 return <div className="ud-panel">
  <div className="ud-top"><div><span className="ud-eyebrow">USAGE OVERVIEW</span><h3>用量仪表盘</h3></div><button aria-label="刷新用量" onClick={()=>setTick(v=>v+1)}>刷新</button></div>
  <div className="ud-period">{[[1,'今天'],[7,'近 7 天'],[30,'近 30 天']].map(([n,label])=><button key={n} className={days===n?'on':''} onClick={()=>{setDays(Number(n));setPage(0);setPoint(null)}}>{label}</button>)}</div>
  {(error||data?.error)&&<p className="ud-error" role="alert">{error||data?.error}</p>}
  {!data?<p>正在读取本地用量…</p>:<>
   <section className="ud-hero"><span>{project?data.projects.find(p=>p.path===project)?.name||'选中项目':'全部项目'} · 已记录 Token</span><strong>{s!.known?fmt(s!.tokens):'—'}</strong><p>{s!.rounds} 轮请求 · {s!.known} 轮有计量 · {s!.rounds-s!.known} 轮未知或进行中</p><div className="ud-metrics"><div>输入<b>{s!.known?fmt(s!.input):'—'}</b></div><div>输出<b>{s!.known?fmt(s!.output):'—'}</b></div><div>缓存读取<b>{s!.cacheKnown?fmt(s!.cacheRead):'—'}</b></div><div>缓存写入<b>{s!.cacheWriteKnown?fmt(s!.cacheWrite):'—'}</b></div><div>已知费用 · USD<b>{s!.costKnown?'$'+s!.costUsd.toFixed(3):'未知'}</b></div></div></section>
   {!s!.rounds&&<div className="ud-empty"><b>还没有这一期间的记录</b><p>从此版本开始采集 AI 对话用量。历史聊天不会被重发或扫描记账。</p></div>}
   <section className="ud-card"><div className="ud-heading"><b>{project?'项目':'整体'}用量趋势</b><span>峰值 {s?.known?fmt(Math.max(0,...data.buckets.map(b=>b.summary.tokens))):'—'} Token / 区间</span></div>
    <svg viewBox="0 0 340 128" className="ud-chart" aria-label="用量时间趋势，使用 Tab 查看各时间区间">
     {[22,65,108].map(v=><line key={v} x1="12" y1={v} x2="328" y2={v} className="ud-grid"/>)}
     {data.buckets.map((b,i)=>{
      const prev=data.buckets[i-1], known=b.summary.known>0||(b.summary.rounds===0&&b.at>=data.retainedFrom)
      return <g key={i}>{i>0&&known&&(prev.summary.known>0||(prev.summary.rounds===0&&prev.at>=data.retainedFrom))&&<line x1={x(i-1)} y1={y(prev.summary.tokens)} x2={x(i)} y2={y(b.summary.tokens)} className="ud-line"/>}
       <circle cx={x(i)} cy={known?y(b.summary.tokens):118} r={point===i?5:3} className={known?'ud-dot':'ud-unknown'} tabIndex={0} role="button" aria-label={time(b.at)+'，'+(known?b.summary.tokens+' Token':'计量未知')} onFocus={()=>setPoint(i)} onBlur={()=>setPoint(null)} onMouseEnter={()=>setPoint(i)} onMouseLeave={()=>setPoint(null)} onClick={()=>setPoint(i)}><title>{time(b.at)} · {known?fmt(b.summary.tokens):'未知'} Token</title></circle>
      </g>
     })}
    </svg><div className="ud-axis"><span>{time(query.from)}</span><span>{time(query.to)}</span></div>
    <p className="ud-chart-caption">{selected?time(selected.at)+' 起 · '+selected.summary.rounds+' 轮 · '+(selected.summary.known?fmt(selected.summary.tokens)+' Token（已知部分）':selected.summary.rounds?'用量未上报':selected.at<data.retainedFrom?'未采集区间':'无请求'):'24 个等时区间；圆点可悬停/聚焦，未知区间断线，不补零。'}</p>
   </section>
   <section className="ud-card"><div className="ud-heading"><b>项目用量</b><button onClick={()=>select('')} className={!project?'on':''}>全部</button></div>
    {data.projects.map(p=><button key={p.path} title={p.path} className={'ud-project'+(project===p.path?' selected':'')} onClick={()=>select(p.path)}><span>{p.name}<small>{p.summary.rounds} 轮 · {p.summary.known} 轮有计量</small></span><b>{p.summary.known?fmt(p.summary.tokens):'未知'}</b><svg viewBox="0 0 316 40" className="ud-project-trend" aria-label={p.name+'时间趋势，点击查看大图'}>{p.trend.map((v,i)=>i>0&&v!==null&&p.trend[i-1]!==null?<line key={i} x1={(i-1)*316/23} y1={36-p.trend[i-1]!/Math.max(1,...p.trend.map(v=>v??0))*30} x2={i*316/23} y2={36-v/Math.max(1,...p.trend.map(v=>v??0))*30} className="ud-line"/>:null)}</svg><i style={{width:(s!.tokens?Math.min(100,p.summary.tokens/Math.max(...data.projects.map(p=>p.summary.tokens),1)*100):0)+'%'}}/></button>)}
   </section>
   <section className="ud-card"><div className="ud-heading"><b>消耗分布</b><span>当前筛选范围</span></div>{data.cli.map(c=><div className="ud-stat" key={c.name}><span>{c.name}</span><b>{c.summary.known?fmt(c.summary.tokens):'未知'} Token</b></div>)}<div className="ud-stat"><span>平均每轮 · 仅有计量</span><b>{s!.known?fmt(s!.tokens/s!.known):'—'}</b></div><div className="ud-stat"><span>单轮峰值</span><b>{s!.known?fmt(s!.maxTokens):'—'}</b></div><div className="ud-stat"><span>已中断请求</span><b>{s!.interrupted} 轮</b></div><div className="ud-stat"><span>Token 计量覆盖率</span><b>{s!.rounds?Math.round(s!.known/s!.rounds*100)+'%':'—'}</b></div><div className="ud-stat"><span>费用可归属</span><b>{s!.costKnown} / {s!.rounds} 轮</b></div></section>
   <section className="ud-card"><div className="ud-heading"><b>任务阶段</b><span>仅使用手动标签</span></div>{data.stages.map(c=><div className="ud-stat" key={c.name}><span>{c.name}</span><b>{c.summary.known?fmt(c.summary.tokens):'未知'} Token</b></div>)}</section>
   <section className="ud-card"><div className="ud-heading"><b>会话 → 每轮明细</b><span>共 {data.matched} 轮</span></div>{[...sessions].map(([id,rows])=><details key={id} className="ud-session"><summary>会话 {id.slice(0,12)} <small>本页 {rows.length} 轮 / 全期 {data.sessions.find(s=>s.id===id)?.summary.rounds} 轮 · {data.sessions.find(s=>s.id===id)?.summary.known?fmt(data.sessions.find(s=>s.id===id)!.summary.tokens):'未知'} Token（已知部分）</small></summary>{rows.map(row=><Round key={row.id} row={row} refresh={()=>setTick(v=>v+1)} onError={setError}/>)}</details>)}<div className="ud-pagination"><button disabled={!page} onClick={()=>setPage(v=>v-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(data.matched/100))}</span><button disabled={(page+1)*100>=data.matched} onClick={()=>setPage(v=>v+1)}>下一页</button></div></section>
   <button className="ud-export" onClick={()=>void window.api.usage.export(query).then(r=>{if(!r.ok&&!r.cancelled)setError(r.error||'导出失败')}).catch(e=>setError(String(e)))}>导出当前筛选明细 CSV</button>
   <p className="ud-foot">采集起点：{time(data.since)}<br/>保留边界：{time(data.retainedFrom)} · 最多 90 天 / 50,000 轮。<br/>仅统计 Eas-Term AI 对话；未采集的历史、外部终端和缺失值不算 0。输入含上下文，并非只算本轮文字。输入包含缓存读写；OMP 优先用上报总量减输出还原总输入。<br/>费用仅含 Claude 同一进程连续累计值的差额；首次、跨进程、缺报区间及其他 CLI 的费用未知。这不是供应商账单。</p>
  </>}
 </div>
}
