import fs from 'node:fs'
import type { UsageQuery, UsageRow, UsageSnapshot } from '../../shared/usage.ts'
import { summarize } from './core.ts'
export interface LedgerFile {version:1; since:number; rows:UsageRow[]}
export function loadLedger(file:string): LedgerFile {
 if (!fs.existsSync(file)) return {version:1,since:Date.now(),rows:[]}
 if (fs.statSync(file).size > 40*1024*1024) throw new Error('用量账本超出安全读取上限')
 const data=JSON.parse(fs.readFileSync(file,'utf8')) as LedgerFile
 if (data.version!==1 || !Number.isFinite(data.since) || !Array.isArray(data.rows) || data.rows.length>50000) throw new Error('用量账本格式无效，原文件已保留')
 const ids=new Set<string>()
 for(const r of data.rows) {
  if (!r || !['id','session','project','projectName','cli','model'].every(k=>typeof r[k as keyof UsageRow]==='string') || !Number.isFinite(r.startedAt) || !['running','completed','interrupted'].includes(r.status) || ids.has(r.id)) throw new Error('用量账本记录无效，原文件已保留')
  if(r.stage!==undefined&&(typeof r.stage!=='string'||r.stage.length>60||/[\x00-\x1f]/.test(r.stage)))throw new Error('阶段字段无效，原文件已保留')
  if(r.endedAt!==undefined&&(!Number.isFinite(r.endedAt)||r.endedAt<r.startedAt))throw new Error('结束时间无效')
  ids.add(r.id)
  if (r.meter && (!['input','output'].every(k=>Number.isFinite(r.meter![k as 'input'|'output']) && r.meter![k as 'input'|'output']>=0) || Object.values(r.meter).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))) throw new Error('用量计量无效')
  if (r.costUsd!==undefined && (!Number.isFinite(r.costUsd)||r.costUsd<0)) throw new Error('费用计量无效')
  if(r.status==='running') r.status='interrupted'
 }
 return data
}
export async function saveLedger(file:string,data:LedgerFile):Promise<void> {
 const text=JSON.stringify(data)
 if(Buffer.byteLength(text,'utf8')>40*1024*1024)throw new Error('用量账本超出40MB写入上限，原文件已保留')
 const tmp=file+'.tmp'
 await fs.promises.writeFile(tmp,text,{mode:0o600})
 await fs.promises.rename(tmp,file)
}
export function validateQuery(raw:unknown):UsageQuery {
 const q=raw as UsageQuery
 if(!q || !Number.isFinite(q.from)||!Number.isFinite(q.to)||q.from<0||q.to<=q.from||q.to-q.from>91*86400000 || (q.page!==undefined&&(!Number.isInteger(q.page)||q.page<0||q.page>500)) || (q.project!==undefined&&(typeof q.project!=='string'||q.project.length>4096))) throw new Error('无效的用量查询范围')
 return {from:q.from,to:q.to,project:q.project,page:q.page??0}
}
export function queryLedger(data:LedgerFile,q:UsageQuery):UsageSnapshot {
 const period=data.rows.filter(r=>r.startedAt>=q.from&&r.startedAt<q.to)
 const rows=period.filter(r=>!q.project||r.project===q.project)
 const group=(key:(r:UsageRow)=>string)=> {
  const groups=new Map<string,UsageRow[]>()
  for(const r of rows){const k=key(r); const a=groups.get(k)??[]; a.push(r);groups.set(k,a)}
  return [...groups].map(([name,rs])=>({name,summary:summarize(rs,q.from,q.to)}))
 }
 const projects=new Map<string,UsageRow[]>()
 for(const r of period){const a=projects.get(r.project)??[];a.push(r);projects.set(r.project,a)}
 const n=24, step=(q.to-q.from)/n
 const retainedFrom=Math.max(data.since,Date.now()-90*86400000, data.rows.length===50000?Math.min(...data.rows.map(r=>r.startedAt)):0)
 const trend=(rs:UsageRow[]):(number|null)[]=>{
  const groups:Array<UsageRow[]>=Array.from({length:n},()=>[])
  for(const r of rs)groups[Math.min(n-1,Math.floor((r.startedAt-q.from)/step))].push(r)
  return groups.map((rs,i)=>{const s=summarize(rs,q.from,q.to);return s.known?s.tokens:(!s.rounds&&q.from+i*step>=retainedFrom?0:null)})
 }
 const bins:Array<UsageRow[]>=Array.from({length:n},()=>[])
 for(const r of rows) bins[Math.min(n-1,Math.floor((r.startedAt-q.from)/step))].push(r)
 const pageRows=[...rows].sort((a,b)=>b.startedAt-a.startedAt).slice((q.page??0)*100,((q.page??0)+1)*100)
 const visibleSessions=new Set(pageRows.map(r=>r.session))
 const sessions=new Map<string,UsageRow[]>()
 for(const r of rows){if(!visibleSessions.has(r.session))continue;const group=sessions.get(r.session)??[];group.push(r);sessions.set(r.session,group)}
 return {
  sessions:[...sessions].map(([id,rs])=>({id,summary:summarize(rs,q.from,q.to)})),
  summary:summarize(rows,q.from,q.to),
  projects:[...projects].map(([path,rs])=>({path,name:rs[rs.length-1].projectName,trend:trend(rs),summary:summarize(rs,q.from,q.to)})).sort((a,b)=>b.summary.tokens-a.summary.tokens),
  cli:group(r=>r.cli),stages:group(r=>r.stage||'未标记'),
  buckets:bins.map((rs,i)=>({at:q.from+i*step,summary:summarize(rs,q.from,q.to)})),
  rows:pageRows,
  matched:rows.length,page:q.page??0,since:data.since,retainedFrom
 }
}
export function csvOf(rows:UsageRow[]):string {
 const cell=(v:unknown)=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,m=>"'"+m).replace(/"/g,'""')+'"'
 return '\ufeff'+[['请求时间','项目','会话','CLI','模型','阶段','状态','输入','输出','缓存读','缓存写','已知USD'],...rows.map(r=>[new Date(r.startedAt).toISOString(),r.projectName,r.session,r.cli,r.model,r.stage??'',r.status,r.meter?.input,r.meter?.output,r.meter?.cacheRead,r.meter?.cacheWrite,r.costUsd])].map(r=>r.map(cell).join(',')).join('\r\n')
}
