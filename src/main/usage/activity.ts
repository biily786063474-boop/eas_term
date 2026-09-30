import { tm } from '../../shared/i18n/current.ts'
import { ACTIVITY_KEYS, type ActivityKey, type ActivityDay, type ActivityLedger, type UsageActivitySnapshot, type PluginActivity } from '../../shared/activity.ts'
import type { UsageRow } from '../../shared/usage.ts'
export function dayKey(at:number):string {
 const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function midnight(at:number,offset=0):number {const d=new Date(at);return new Date(d.getFullYear(),d.getMonth(),d.getDate()+offset).getTime()}
const validCount=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(v)
const isKey=(v:unknown):v is ActivityKey=>typeof v==='string'&&(ACTIVITY_KEYS as readonly string[]).includes(v)
export function parseActivity(raw:unknown):ActivityLedger {
 const d=raw as ActivityLedger
 if(!d||d.version!==1||!Number.isFinite(d.since)||d.since<0||!Array.isArray(d.days)||d.days.length>90)throw Error(tm('errCore.usage.activityFormat'))
 const seen=new Set<string>()
 const days=d.days.map(day=>{
  if(!day||typeof day.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||dayKey(new Date(day.date+'T12:00:00').getTime())!==day.date||seen.has(day.date)||!day.counts||typeof day.counts!=='object'||Array.isArray(day.counts)||!Array.isArray(day.plugins)||day.plugins.length>128)throw Error(tm('errCore.usage.activityDate'))
  seen.add(day.date)
  const counts:ActivityDay['counts']={}
  for(const [k,v] of Object.entries(day.counts)){if(!isKey(k)||!validCount(v))throw Error(tm('errCore.usage.activityCount'));counts[k]=v}
  const ids=new Set<string>()
  const plugins=day.plugins.map(p=>{
   if(!p||!validId(p.id)||ids.has(p.id)||!validCount(p.opens)||!validCount(p.calls))throw Error(tm('errCore.usage.pluginCount'))
   ids.add(p.id);return {id:p.id,opens:p.opens,calls:p.calls}
  })
  return {date:day.date,counts,plugins}
 })
 return {version:1,since:d.since,days}
}
export class ActivityBook {
 data:ActivityLedger
 constructor(since:number){this.data={version:1,since,days:[]}}
 private day(at:number):ActivityDay {
  this.prune(at)
  const key=dayKey(at);let d=this.data.days.find(d=>d.date===key)
  if(!d){d={date:key,counts:{},plugins:[]};this.data.days.push(d)}
  return d
 }
 record(key:unknown,at:number):boolean {
  if(!isKey(key)||!Number.isFinite(at)||at<0)return false
  const d=this.day(at);d.counts[key]=Math.min(Number.MAX_SAFE_INTEGER,(d.counts[key]??0)+1);return true
 }
 recordPlugin(id:unknown,kind:'open'|'call',at:number):boolean {
  if(!validId(id)||!Number.isFinite(at)||at<0)return false
  const d=this.day(at);let p=d.plugins.find(p=>p.id===id)
  if(!p){if(d.plugins.length>=128)return false;p={id,opens:0,calls:0};d.plugins.push(p)}
  const key=kind==='open'?'opens':'calls';p[key]=Math.min(Number.MAX_SAFE_INTEGER,p[key]+1);return true
 }
 prune(now:number,days=90):void {const from=dayKey(midnight(now,1-days));this.data.days=this.data.days.filter(d=>d.date>=from).slice(-days)}
}
export function activitySnapshot(data:ActivityLedger,rows:UsageRow[],tokenSince:number,now:number,days=90,available={activity:true,token:true}):UsageActivitySnapshot {
 const from=midnight(now,1-days),entries=new Map((available.activity?data.days:[]).map(d=>[d.date,d]))
 const groups=new Map<string,UsageRow[]>(),sessions=new Set<string>(),projects=new Set<string>()
 for(const r of rows){if(r.startedAt<from||r.startedAt>now)continue;const key=dayKey(r.startedAt);const rs=groups.get(key)??[];rs.push(r);groups.set(key,rs);sessions.add(r.session);projects.add(r.project)}
 const counts:Partial<Record<ActivityKey,number>>={},plugins=new Map<string,PluginActivity>()
 const result:UsageActivitySnapshot['days']=[]
 for(let i=1-days;i<=0;i++){
  const at=midnight(now,i),end=midnight(now,i+1),date=dayKey(at),entry=entries.get(date),rs=groups.get(date)??[]
  const measured=rs.filter(r=>r.meter!==undefined),known=measured.length>0||(!rs.length&&at>=tokenSince)
  let actions=0
  if(entry){for(const key of ACTIVITY_KEYS){const n=entry.counts[key]??0;actions+=n;counts[key]=(counts[key]??0)+n}
   for(const p of entry.plugins){actions+=p.opens+p.calls;const total=plugins.get(p.id)??{id:p.id,opens:0,calls:0};total.opens+=p.opens;total.calls+=p.calls;plugins.set(p.id,total)}}
  result.push({date,tokens:available.token&&known?measured.reduce((s,r)=>s+r.meter!.input+r.meter!.output,0):null,rounds:available.token?rs.length:null,tokenPartial:at<tokenSince||measured.length<rs.length,actions:available.activity&&(entry||at>=data.since)?actions:null,activityPartial:at<data.since&&end>data.since})
 }
 let longestStreak=0,streak=0,activeDays=0
 for(const d of result){streak=(d.actions??0)>0?streak+1:0;longestStreak=Math.max(longestStreak,streak);if((d.actions??0)>0)activeDays++}
 let index=result.length-1,currentStreak=0
 if(!(result[index]?.actions??0))index--
 while(index>=0&&(result[index].actions??0)>0){currentStreak++;index--}
 return {days:result,activeDays,currentStreak,longestStreak,sessions:available.token?sessions.size:null,projects:available.token?projects.size:null,activityAvailable:available.activity,tokenAvailable:available.token,features:ACTIVITY_KEYS.map(key=>({key,count:counts[key]??0})).sort((a,b)=>b.count-a.count),plugins:[...plugins.values()].sort((a,b)=>(b.opens+b.calls)-(a.opens+a.calls)),since:data.since,tokenSince}
}
