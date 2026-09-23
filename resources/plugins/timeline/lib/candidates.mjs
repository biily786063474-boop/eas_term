import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {candidateFromEvent} from './capture.mjs'
import {record} from './store.mjs'
function location(cwd){if(!path.isAbsolute(cwd)||!fs.statSync(cwd).isDirectory())throw Error('项目路径无效');const dir=path.join(fs.realpathSync(cwd),'.eas');const file=path.join(dir,'timeline-candidates.json');for(const p of [dir,file]){try{if(fs.lstatSync(p).isSymbolicLink())throw Error('候选路径不能为软链')}catch(e){if(e.code!=='ENOENT')throw e}}return {dir,file}}
function read(file){try{if(fs.statSync(file).size>16*1024*1024)throw Error('候选容量超限');const d=JSON.parse(fs.readFileSync(file,'utf8'));if(d.version!==1||!Array.isArray(d.items)||d.items.length>20000||d.items.some(x=>!x.id||!x.source?.eventId||!['pending','confirmed','ignored'].includes(x.review)))throw Error('候选数据损坏');return d}catch(e){if(e.code==='ENOENT')return {version:1,items:[]};throw e}}
function change(cwd,fn){const {dir,file}=location(cwd);fs.mkdirSync(dir,{recursive:true});const lock=file+'.lock';const fd=fs.openSync(lock,'wx',0o600);let tmp;try{const d=read(file),result=fn(d);if(d.items.length>20000)throw Error('候选数量超限');const s=JSON.stringify(d);if(Buffer.byteLength(s)>16*1024*1024)throw Error('候选容量超限');tmp=file+'.'+randomUUID()+'.tmp';const out=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(out,s);fs.fsyncSync(out)}finally{fs.closeSync(out)}location(cwd);fs.renameSync(tmp,file);tmp=undefined;return result}finally{if(tmp)fs.unlinkSync(tmp);fs.closeSync(fd);fs.unlinkSync(lock)}}
export function capture(cwd,event){const value=candidateFromEvent(event);if(!value)return {captured:false};return change(cwd,d=>{const id=createHash('sha256').update(event.projectId+'\0'+event.eventId).digest('hex');if(d.items.some(x=>x.id===id))return {captured:false,id};d.items.push({...value,id,review:'pending'});return {captured:true,id}})}
export function candidates(cwd){return read(location(cwd).file).items.filter(x=>x.review==='pending')}
export function resolveCandidate(cwd,id,decision){if(!['confirm','ignore'].includes(decision))throw Error('候选操作无效');return change(cwd,d=>{const c=d.items.find(x=>x.id===id);if(!c)throw Error('候选不存在');if(c.review!=='pending')return {changed:false};let receipt;if(decision==='confirm')receipt=record(cwd,{taskKey:'capture:'+c.id,title:c.title,summary:c.summary,date:c.date,status:'pending',author:'自动捕获 · 用户收录',evidence:[]});c.review=decision==='confirm'?'confirmed':'ignored';return {changed:true,receipt}})}

/** Host-only enrichment; never changes candidate review or creates a milestone. */
export function attachJevSuggestion(cwd,id,value){
 const probability=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1
 if(!value||value.candidateId!==id||value.requiresReview!==true)throw Error('建议身份无效')
 const suggestion={provider:'jev',requiresReview:true}
 if(value.milestone){if(!probability(value.milestone.probability)||value.milestone.accepted!==false)throw Error('建议不能认定验收');suggestion.milestone={probability:value.milestone.probability,accepted:false}}
 if(value.project){if(value.project.projectId!==null&&typeof value.project.projectId!=='string'||!probability(value.project.confidence))throw Error('项目建议无效');suggestion.project={projectId:value.project.projectId,confidence:value.project.confidence}}
 if(!suggestion.milestone&&!suggestion.project)return {changed:false}
 return change(cwd,d=>{const candidate=d.items.find(c=>c.id===id);if(!candidate||candidate.review!=='pending')return {changed:false};candidate.jev=suggestion;return {changed:true}})
}
