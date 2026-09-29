import { useState } from 'react'
import type { ActivityKey, UsageActivitySnapshot } from '../../../../shared/activity'
import { locale } from '../../i18n.ts'
import './usageActivity.css'
const labels:Record<ActivityKey,string>={term:'终端入口使用',canvas:'新增内容 / 组件',voice:'启动语音输入',image:'添加图片',island:'返回会话',approve:'处理审批',view:'切换视图',agent:'AI 面板入口使用',chat:'AI 请求启动'}
const fmt=(n:number):string=>Intl.NumberFormat(locale(),{notation:'compact',maximumFractionDigits:1}).format(n)
export function UsageActivity({data,error}:{data:UsageActivitySnapshot|null;error:string}):JSX.Element {
 const [mode,setMode]=useState<'token'|'activity'>('token')
 const [selected,setSelected]=useState<number|null>(null)
 const [more,setMore]=useState(false)
 if(!data)return <section className="ud-card"><b>活动热力图</b><p className={error?'ud-error':'ud-foot'}>{error||'正在读取本地活动…'}</p></section>
 const value=(d:UsageActivitySnapshot['days'][number]):number|null=>mode==='token'?d.tokens:d.actions
 const peak=Math.max(1,...data.days.map(d=>value(d)??0))
 const first=new Date(data.days[0].date+'T12:00:00'),padding=(first.getDay()+6)%7
 const columns=Math.ceil((padding+data.days.length)/7)
 const active=selected===null?null:data.days[selected]
 const detail=active?active.date+' · '+(value(active)===null?'未记录':fmt(value(active)!)+(mode==='token'?' Token':' 次操作'))+(mode==='token'?' · '+(active.rounds===null?'请求数未记录':active.rounds+' 轮请求'):'')+((mode==='token'?active.tokenPartial:active.activityPartial)?' · 部分记录':''):'悬停或用键盘聚焦，查看每日记录'
 const knownActivity=data.days.some(d=>d.actions!==null)
 const featureRows=data.features.filter(f=>f.count>0)
 const counts=[['活跃天数',data.activeDays],['当前连续',data.currentStreak],['最长连续',data.longestStreak]] as const
 return <>
  <section className="ud-card ua-card" aria-label="活动热力图">
   <div className="ud-heading"><b>活动热力图</b><span>近 90 天 · 本地日期</span></div>
   <div className="ua-tabs" role="group" aria-label="热力图统计口径">{([['token','Token'],['activity','软件活跃']] as const).map(([key,label])=><button key={key} aria-pressed={mode===key} className={mode===key?'on':''} onClick={()=>{setMode(key);setSelected(null)}}>{label}</button>)}</div>
   <div className="ua-calendar"><div className="ua-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span><span>日</span></div><div className="ua-grid" style={{gridTemplateColumns:'repeat('+columns+', minmax(0,1fr))'}}>
    {Array.from({length:padding},(_,i)=><i key={'pad'+i}/>)}
    {data.days.map((d,i)=>{const v=value(d),level=v===null?-1:v===0?0:Math.min(4,Math.max(1,Math.ceil(Math.sqrt(v/peak)*4)))
     const label=d.date+'，'+(v===null?'未记录':v+(mode==='token'?' Token':' 次操作'))+((mode==='token'?d.tokenPartial:d.activityPartial)?'，部分记录':'')
     return <button key={d.date} className={'ua-cell ua-level-'+level} aria-label={label} onMouseEnter={()=>setSelected(i)} onMouseLeave={()=>setSelected(null)} onFocus={()=>setSelected(i)} onBlur={()=>setSelected(null)} onClick={()=>setSelected(i)} />})}
   </div></div>
   <div className="ua-axis"><span>{data.days[0].date.slice(5).replace('-',' / ')}</span><span>{data.days.at(-1)!.date.slice(5).replace('-',' / ')}</span></div>
   <div className="ua-legend"><span>未记录</span><i className="ua-level--1"/><span>少</span>{[0,1,2,3,4].map(v=><i key={v} className={'ua-level-'+v}/>)}<span>多</span></div>
   <p className="ua-detail" role="status">{detail}</p>
  </section>
  <section className="ud-card ua-behavior" aria-label="Eas-Term 行为统计">
   <div className="ud-heading"><b>行为统计</b><span>Eas-Term · 近 90 天</span></div>
   {(error||data.error)&&<p className="ud-error" role="alert">{error||data.error}</p>}
   <div className="ua-metrics">{counts.map(([label,n])=><div key={label}><span>{label}</span><strong>{knownActivity?n:'—'}<small>天</small></strong></div>)}</div>
   <div className="ud-stat"><span>有请求的 AI 会话</span><b>{data.sessions===null?'—':data.sessions+' 个'}</b></div><div className="ud-stat"><span>有请求的项目</span><b>{data.projects===null?'—':data.projects+' 个'}</b></div>
   <h4>常用功能</h4>
   {!featureRows.length?<p className="ud-foot">{data.activityAvailable?'还没有功能使用记录，从本次更新开始积累。':'本地行为记录暂不可读取。'}</p>:featureRows.slice(0,more?undefined:4).map(f=><div className="ud-stat" key={f.key}><span>{labels[f.key]}</span><b>{fmt(f.count)} 次</b></div>)}
   {featureRows.length>4&&<button className="ua-more" aria-expanded={more} onClick={()=>setMore(!more)}>{more?'收起':'查看全部功能'}</button>}
   <h4>常用插件</h4>
   {!data.plugins.length?<p className="ud-foot">{data.activityAvailable?'还没有 Eas-Term 插件使用记录。':'本地插件记录暂不可读取。'}</p>:data.plugins.slice(0,5).map(p=><div className="ud-stat" key={p.id}><span>{p.id}</span><b>{fmt(p.opens)} 次打开 · {fmt(p.calls)} 次 AI 调用</b></div>)}
   <details className="ua-method"><summary>统计口径与隐私</summary><p>软件活跃按功能触发、AI 请求启动、插件面板打开及 AI 成功工具调用计数，不是鼠标点击数或在线时长。功能入口按触发计数，取消或失败也可能计入。面板内部工具请求（含后台刷新）、发现和连接不计入；不包含 CLI 自有 Skill。</p><p>当前连续可从昨天延续；连续天数仅基于近 90 天已记录操作。会话与项目来自本地 AI 用量账本，不代表所有已创建项目。</p><p>行为采集起点：{data.activityAvailable?new Date(data.since).toLocaleString(locale()):'不可读取'}。Token 保留边界：{data.tokenAvailable?new Date(data.tokenSince).toLocaleString(locale()):'不可读取'}。历史缺失不补零；部分记录单独标注。</p><p>只在本机保存日期、功能计数与插件标识，最多 90 天；不记录正文、命令、密钥，不上传。这与设置中的匿名统计开关独立。</p></details>
  </section>
 </>
}
