import type { ReceiptContent } from '../canvas/receiptReport'
import { t } from '../../i18n.ts'
interface Report {
 week:0|-1;from:string;to:string;total:number;statuses:{pending:number;verified:number;accepted:number};activeDays:number;projectCount:number;scope:string
 projects:{name:string;count:number}[];highlights:{title:string;status:'pending'|'verified'|'accepted';projectName:string}[];partial:boolean
}
const clip=(s:string,n:number):string=>Array.from(String(s)).slice(0,n).join('')
export function timelineReceipt(raw:unknown):ReceiptContent {
 const r=raw as Report
 if(!r||![0,-1].includes(r.week)||typeof r.from!=='string'||typeof r.to!=='string'||!Array.isArray(r.projects)||!Array.isArray(r.highlights)||!r.statuses||[r.total,r.activeDays,r.projectCount,...Object.values(r.statuses)].some(n=>!Number.isSafeInteger(n)||n<0))throw Error('时间线周报数据无效') // i18n-allow: 回给插件的协议错误
 const states={pending:t('pluginShell.receipt.state.pending'),verified:t('pluginShell.receipt.state.verified'),accepted:t('pluginShell.receipt.state.accepted')},colon=t('pluginShell.receipt.colon')
 const title=t(r.week===0?'pluginShell.receipt.thisWeek':'pluginShell.receipt.lastWeek'),dates=r.from+' — '+r.to+(r.week===0?t('pluginShell.receipt.untilNow'):'')
 const rows:[string,string][]=[[states.accepted,String(r.statuses.accepted)],[states.verified,String(r.statuses.verified)],[states.pending,String(r.statuses.pending)],[t('pluginShell.receipt.activeDays'),t('pluginShell.receipt.days',{n:r.activeDays})],[t('pluginShell.receipt.projectCount'),t('pluginShell.receipt.items',{n:r.projectCount})],[t('pluginShell.receipt.scope'),clip(r.scope,22)]]
 const projects:[string,string][]=r.projects.slice(0,3).map((p,i)=>[String(i+1).padStart(2,'0')+'  '+clip(p.name,16),t('pluginShell.receipt.itemCount',{n:p.count})])
 const highlights:[string,string][]=r.highlights.slice(0,3).map(h=>[clip(h.title,28),clip(h.projectName,16)+' · '+(states[h.status]??states.pending)])
 const notes=[t(r.partial?'pluginShell.receipt.notePartial':'pluginShell.receipt.noteFull'),t('pluginShell.receipt.noteWeek'),t('pluginShell.receipt.noteStatus'),t('pluginShell.receipt.noteCandidates')]
 const text=['EAS-TERM / '+title,dates,t('pluginShell.receipt.recorded')+colon+r.total,...rows.map(([k,v])=>k+colon+v),t('pluginShell.receipt.topProjects'),...projects.map(([k,v])=>k+colon+v),t('pluginShell.receipt.highlights'),...highlights.map(([k,v])=>k+' / '+v),...notes].join('\n')
 return {title,dates,total:String(r.total),totalLabel:t('pluginShell.receipt.recorded'),sectionLabel:t('pluginShell.receipt.section'),rows,projects,highlights,notes,text}
}
