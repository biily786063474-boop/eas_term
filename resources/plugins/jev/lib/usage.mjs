import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
const sources=new Set(['connection','milestone','project','triage','docs','eval','route','custom'])
/** Local request metadata only. Reserved requests count even on crash or uncertain provider result. */
export function usageStore(directory,{dailyLimit=100,now=()=>new Date()}={}){
 const root=fs.realpathSync(directory),file=path.join(root,'usage.json')
 if(!Number.isSafeInteger(dailyLimit)||dailyLimit<1)throw Error('Invalid request budget')
 let state={day:'',count:0,records:[]}
 try{
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>131072)throw Error('Invalid usage')
  const value=JSON.parse(fs.readFileSync(file,'utf8'))
  if(!value||typeof value.day!=='string'||!Number.isSafeInteger(value.count)||value.count<0||!Array.isArray(value.records)||value.records.length>200)throw Error('Invalid usage')
  state={day:value.day,count:value.count,records:value.records.map(r=>{
   if(typeof r.id!=='string'||typeof r.at!=='string'||!sources.has(r.source)||!['pending','success','failed','revoked'].includes(r.status))throw Error('Invalid usage record')
   return {id:r.id,at:r.at,source:r.source,status:r.status,...(r.usage?{usage:tokens(r.usage)}:{})}
  })}
 }catch(error){if(error.code!=='ENOENT')throw Error('Jev 用量记录损坏，已停止调用以保护预算')}
 function tokens(value){const result={};for(const key of ['input_tokens','output_tokens']){if(!Number.isSafeInteger(value[key])||value[key]<0)throw Error('Invalid usage');result[key]=value[key]}return result}
 function save(next){const temp=path.join(root,'.usage-'+randomUUID());try{fs.writeFileSync(temp,JSON.stringify(next),{flag:'wx',mode:0o600});fs.renameSync(temp,file);state=next}finally{try{fs.unlinkSync(temp)}catch{}}}
 return {
  snapshot(){return {day:state.day,count:state.count,dailyLimit,records:structuredClone(state.records),cost:null}},
  reserve(source){
   if(!sources.has(source))throw Error('Invalid request source')
   const at=now().toISOString(),day=at.slice(0,10),count=state.day===day?state.count:0
   if(count>=dailyLimit)throw Error('Jev 今日调用次数已达上限')
   const id=randomUUID();save({day,count:count+1,records:[...state.records,{id,at,source,status:'pending'}].slice(-200)});return id
  },
  finish(id,status,usage){if(!['success','failed','revoked'].includes(status))throw Error('Invalid request status');const safe=usage?tokens(usage):undefined;save({...state,records:state.records.map(r=>r.id===id?{...r,status,...(safe?{usage:safe}:{})}:r)})}
 }
}
