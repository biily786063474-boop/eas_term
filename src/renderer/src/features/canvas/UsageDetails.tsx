import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { UsageSnapshot, UsageSummary, UsageRow } from '../../../../shared/usage'
const fmt=(n:number):string=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(n)
const time=(n:number):string=>new Date(n).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})

/** Measure actual wrapped rows rather than guessing heights from font sizes. */
function ThreeRowScroll({kind,children}:{kind:'sessions'|'rounds';children:ReactNode}):JSX.Element {
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
 return <div ref={ref} className={'ud-three-scroll ud-'+kind+'-scroll'} tabIndex={0} role="region" aria-label={kind==='sessions'?'会话列表，默认显示三条，滚动查看更多':'每轮明细，默认显示三条，滚动查看更多'}>{children}</div>
}

function Round({row,refresh,onError}:{row:UsageRow;refresh:()=>void;onError:(s:string)=>void}):JSX.Element {
 const [stage,setStage]=useState(row.stage??'')
 const [busy,setBusy]=useState(false)
 return <details className="ud-round" data-usage-row={row.id}><summary><span>{time(row.startedAt)} · {row.cli}</span><b>{row.meter?fmt(row.meter.input+row.meter.output):'未知'} <small>token</small></b></summary>
  <p>{row.model} · {row.status==='running'?'进行中':row.status==='interrupted'?'已中断':'已结束'}</p>
  <p>输入 {row.meter?.input.toLocaleString()??'未上报'} · 输出 {row.meter?.output.toLocaleString()??'未上报'}<br/>缓存读 {row.meter?.cacheRead?.toLocaleString()??'未上报'} · 缓存写 {row.meter?.cacheWrite?.toLocaleString()??'未上报'}<br/>费用 {row.costUsd===undefined?'未知':'$'+row.costUsd.toFixed(5)}</p>
  <form onSubmit={e=>{e.preventDefault();setBusy(true);void window.api.usage.stage(row.id,stage).then(refresh).catch(e=>onError(String(e))).finally(()=>setBusy(false))}}>
   <input aria-label="任务阶段" placeholder="手动标记阶段，如：回归测试" maxLength={60} value={stage} onChange={e=>setStage(e.target.value)}/><button disabled={busy}>保存</button>
  </form>
 </details>
}
export function UsageMetrics({s}:{s:UsageSummary}):JSX.Element {
 return <div className="ud-metrics"><div>输入<b>{s.known?fmt(s.input):'—'}</b></div><div>输出<b>{s.known?fmt(s.output):'—'}</b></div><div>缓存读取<b>{s.cacheKnown?fmt(s.cacheRead):'—'}</b></div><div>缓存写入<b>{s.cacheWriteKnown?fmt(s.cacheWrite):'—'}</b></div><div>已知费用 · USD<b>{s.costKnown?'$'+s.costUsd.toFixed(3):'未知'}</b></div></div>
}

export function UsageSessions({data,page,setPage,refresh,onError}:{data:UsageSnapshot;page:number;setPage:(p:number)=>void;refresh:()=>void;onError:(s:string)=>void}):JSX.Element {
 const sessions=new Map<string,UsageRow[]>()
 for(const row of data.rows){const rows=sessions.get(row.session)??[];rows.push(row);sessions.set(row.session,rows)}
 return <details className="ud-session-list"><summary className="ud-heading"><b>会话 → 每轮明细</b><span>共 {data.matched} 轮</span></summary><ThreeRowScroll key={page} kind="sessions">{[...sessions].map(([id,rows])=><details key={id} className="ud-session"><summary>会话 {id.slice(0,12)} <small>本页 {rows.length} 轮 / 全期 {data.sessions.find(s=>s.id===id)?.summary.rounds} 轮 · {data.sessions.find(s=>s.id===id)?.summary.known?fmt(data.sessions.find(s=>s.id===id)!.summary.tokens):'未知'} Token（已知部分）</small></summary><ThreeRowScroll kind="rounds">{rows.map(row=><Round key={row.id} row={row} refresh={refresh} onError={onError}/>)}</ThreeRowScroll></details>)}</ThreeRowScroll><div className="ud-pagination"><button disabled={!page} onClick={()=>setPage(page-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(data.matched/100))}</span><button disabled={(page+1)*100>=data.matched} onClick={()=>setPage(page+1)}>下一页</button></div></details>
}
