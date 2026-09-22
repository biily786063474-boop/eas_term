import {collectGlobal} from './global.mjs'
const day=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
export function weeklyReport(projects,args={},now=new Date()) {
 const week=args.week??0
 if(week!==0&&week!==-1)throw Error('仅支持本周或上周')
 if(args.projectIds!==undefined&&(!Array.isArray(args.projectIds)||args.projectIds.some(id=>!projects.some(p=>p.id===id))))throw Error('项目未授权')
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate())
 start.setDate(start.getDate()-(start.getDay()+6)%7+week*7)
 const end=week===0?now:new Date(start.getFullYear(),start.getMonth(),start.getDate()+6)
 const from=day(start),to=day(end),rows=[],errors=[]
 for(const month of new Set([from.slice(0,7),to.slice(0,7)])) {
  const result=collectGlobal(projects,{month,projectIds:args.projectIds})
  rows.push(...result.items.filter(r=>r.date>=from&&r.date<=to));errors.push(...result.errors)
 }
 const statuses={pending:0,verified:0,accepted:0},counts=new Map()
 for(const r of rows){statuses[r.status]++;const p=counts.get(r.projectId)??{name:r.projectName,count:0};p.count++;counts.set(r.projectId,p)}
 const rank={accepted:0,verified:1,pending:2}
 return {week,from,to,total:rows.length,statuses,activeDays:new Set(rows.map(r=>r.date)).size,projectCount:counts.size,
  scope:args.projectIds===undefined?(projects.length?'全部授权项目':'尚未授权项目'):`已选 ${new Set(args.projectIds).size} 个项目`,
  projects:[...counts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,3),
  highlights:[...rows].sort((a,b)=>rank[a.status]-rank[b.status]||b.date.localeCompare(a.date)||a.title.localeCompare(b.title)).slice(0,3).map(r=>({title:r.title,status:r.status,projectName:r.projectName})),
  partial:errors.length>0,unreadable:[...new Set(errors.map(e=>e.projectName))]}
}
