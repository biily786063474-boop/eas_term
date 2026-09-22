import type { UsageQuery, UsageSnapshot } from '../../../../shared/usage.ts'
export type ReportPeriod = 'week' | 'month'
export function reportRange(period:ReportPeriod, now=new Date()):UsageQuery {
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate())
 if(period==='month')start.setDate(1)
 else start.setDate(start.getDate()-(start.getDay()+6)%7)
 return {from:start.getTime(),to:now.getTime()+1}
}
const number=(n:number):string=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n)
const date=(n:number):string=>new Date(n).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})
export interface ReceiptContent { totalLabel?:string; sectionLabel?:string; highlights?:[string,string][]; title:string; dates:string; total:string; rows:[string,string][]; projects:[string,string][]; notes:string[]; text:string }
export function receiptContent(period:ReportPeriod,range:UsageQuery,data:UsageSnapshot):ReceiptContent {
 const s=data.summary
 const title=period==='week'?'本周用量小票':'本月用量小票'
 const dates=`${date(range.from)} — ${date(range.to-1)} · 至今`
 const total=s.known?number(s.tokens):'—'
 const rows:[string,string][]=[['输入 Token',s.known?number(s.input):'未知'],['输出 Token',s.known?number(s.output):'未知'],['缓存读取 · 已含在输入',s.cacheKnown?number(s.cacheRead):'未知'],['活跃天数 / 会话数',data.activity?`${data.activity.days} 天 / ${data.activity.sessions} 个`:'未知'],['请求轮数 / 有计量',`${s.rounds} / ${s.known}`],['已记录费用 · USD',s.costKnown?`$${s.costUsd.toFixed(4)}`:'未知']]
 const projects:[string,string][]=data.projects.slice(0,3).map((p,i)=>[`${String(i+1).padStart(2,'0')}  ${Array.from(p.name).slice(0,16).join('')}`,p.summary.known?number(p.summary.tokens):'未知'])
 const notes=[`Token 计量 ${s.known}/${s.rounds} 轮 · 费用 ${s.costKnown}/${s.rounds} 轮`,range.from<data.retainedFrom?'本期采集不完整，仅展示保留记录。':'仅统计 Eas-Term 已采集的 AI 对话。','Token 含缓存；缺失值不计作零。','费用仅为已记录部分，非账单或套餐扣额。']
 const text=[`EAS-TERM / ${title}`,dates,`已记录 Token：${total}`,...rows.map(([k,v])=>`${k}：${v}`),'项目用量 TOP 3',...projects.map(([k,v])=>`${k}：${v}`),...notes].join('\n')
 return {title,dates,total,rows,projects,notes,text}
}
const escape=(s:string):string=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
export function receiptSvg(c:ReceiptContent):string {
 const label=(s:string,x:number,y:number,size=12,color='#68645d',anchor='start',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${escape(s)}</text>`
 const line=(y:number)=>`<path d="M32 ${y}H408" stroke="#c9c3b7" stroke-dasharray="4 5"/>`
 const extra=c.highlights?160:0, height=800+extra
 const highlights=c.highlights?label('HIGHLIGHTS / 成果精选',32,638,10)+c.highlights.map(([title,meta],i)=>label(title,32,663+i*35,12,'#282720')+label(meta,32,678+i*35,9)).join('')+line(770):''
 const teeth=Array.from({length:44},(_,i)=>`${440-i*10-5},${793+extra} ${440-i*10-10},${786+extra}`).join(' ')
 return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="${height}" viewBox="0 0 440 ${height}" role="img" aria-label="${escape(c.title)}"><polygon points="0,0 440,0 440,${786+extra} ${teeth}" fill="#f7f3e9"/><g font-family="ui-monospace, SFMono-Regular, Menlo, monospace, sans-serif">${label('E A S – T E R M',32,43,15,'#282720','start',700)}${label(c.highlights?'OUTCOME RECEIPT':'USAGE RECEIPT',408,43,10,'#777269','end')}${line(64)}${label(c.title,220,103,22,'#282720','middle',600)}${label(c.dates,220,129,11,'#68645d','middle')}${label(c.totalLabel??'已记录 TOKEN',220,177,11,'#68645d','middle')}${label(c.total,220,224,c.total.length>12?32:44,'#292a24','middle',700)}${label('每一次思考，都留下刻度。',220,252,11,'#777269','middle')}${line(276)}${c.rows.map(([k,v],i)=>label(k,32,307+i*30)+label(v,408,307+i*30,13,'#282720','end',500)).join('')}${line(477)}${label(c.sectionLabel??'PROJECTS / 用量前三',32,505,10,'#68645d')}${c.projects.length?c.projects.map(([k,v],i)=>label(k,32,533+i*27,12,'#282720')+label(v,408,533+i*27,12,'#282720','end')).join(''):label('本期暂无记录',32,539)}${line(610)}${highlights}${c.notes.map((s,i)=>label(s,32,636+extra+i*20,10)).join('')}<g fill="#595c4c">${Array.from({length:65},(_,i)=>`<rect x="${91+i*4}" y="${726+extra}" width="${i%3===0?3:1}" height="20"/>`).join('')}</g>${label('LOCAL ONLY · MADE WITH EAS-TERM',220,766+extra,9,'#777269','middle')}</g></svg>`
}
export async function receiptPng(svg:string):Promise<string> {
 const image=new Image()
 image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)
 await image.decode()
 const canvas=document.createElement('canvas');canvas.width=image.width*2;canvas.height=image.height*2
 const context=canvas.getContext('2d');if(!context)throw new Error('图片绘制不可用')
 context.drawImage(image,0,0,canvas.width,canvas.height)
 return canvas.toDataURL('image/png')
}
