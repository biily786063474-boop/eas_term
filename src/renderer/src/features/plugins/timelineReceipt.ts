import type { ReceiptContent } from '../canvas/receiptReport'
interface Report {
 week:0|-1;from:string;to:string;total:number;statuses:{pending:number;verified:number;accepted:number};activeDays:number;projectCount:number;scope:string
 projects:{name:string;count:number}[];highlights:{title:string;status:'pending'|'verified'|'accepted';projectName:string}[];partial:boolean
}
const clip=(s:string,n:number):string=>Array.from(String(s)).slice(0,n).join('')
export function timelineReceipt(raw:unknown):ReceiptContent {
 const r=raw as Report
 if(!r||![0,-1].includes(r.week)||typeof r.from!=='string'||typeof r.to!=='string'||!Array.isArray(r.projects)||!Array.isArray(r.highlights)||!r.statuses||[r.total,r.activeDays,r.projectCount,...Object.values(r.statuses)].some(n=>!Number.isSafeInteger(n)||n<0))throw Error('时间线周报数据无效')
 const states={pending:'待验证',verified:'当前已验证',accepted:'当前已验收'}
 const title=(r.week===0?'本周':'上周')+'成果小票',dates=r.from+' — '+r.to+(r.week===0?' · 至今':'')
 const rows:[string,string][]=[['当前已验收',String(r.statuses.accepted)],['当前已验证',String(r.statuses.verified)],['待验证',String(r.statuses.pending)],['有成果记录',r.activeDays+' 天'],['涉及项目',r.projectCount+' 个'],['统计范围',clip(r.scope,22)]]
 const projects:[string,string][]=r.projects.slice(0,3).map((p,i)=>[String(i+1).padStart(2,'0')+'  '+clip(p.name,16),String(p.count)+' 项'])
 const highlights:[string,string][]=r.highlights.slice(0,3).map(h=>[clip(h.title,28),clip(h.projectName,16)+' · '+(states[h.status]??'待验证')])
 const notes=[r.partial?'统计不完整：部分项目不可读。':'仅统计所选项目已记录的独立成果。','按成果发生日归周，同一成果更新不重复计数。','状态为当前状态，不代表本周完成验收。','待确认候选不计入；未记录不代表没有工作。']
 const text=['EAS-TERM / '+title,dates,'已记录独立成果：'+r.total,...rows.map(([k,v])=>k+'：'+v),'项目成果前三',...projects.map(([k,v])=>k+'：'+v),'成果精选',...highlights.map(([k,v])=>k+' / '+v),...notes].join('\n')
 return {title,dates,total:String(r.total),totalLabel:'已记录独立成果',sectionLabel:'PROJECTS / 成果前三',rows,projects,highlights,notes,text}
}
