/** Global admission for managed model turns. No network interception or message storage. */
export interface CliTurnJob {
 key:string; sessionId:string; projectId:string
 start():void
 cancelRunning():void
 failed?(error:unknown):void
}
export interface CliTurnEntry {key:string;sessionId:string;projectId:string;state:'queued'|'running'|'cancel-requested';position:number|null}
export interface CliTurnQueueOptions {
 now():number
 setTimer(fn:()=>void,ms:number):unknown
 clearTimer(timer:unknown):void
 changed?():void
}
export function createCliTurnQueue(opts:CliTurnQueueOptions){
 const queued:CliTurnJob[]=[]
 const running=new Map<string,{job:CliTurnJob;cancelled:boolean}>()
 let limit=2,lastStart=-Infinity,served=0,timer:unknown,disposed=false,pumping=false,paused=false
 const lastServed=new Map<string,number>()
 const changed=()=>{try{opts.changed?.()}catch{/* observers cannot break admission */}}
 const clear=()=>{if(timer!==undefined){opts.clearTimer(timer);timer=undefined}}
 const pump=()=>{
  if(disposed||paused||pumping)return
  clear();pumping=true
  try{
   if(!queued.length||running.size>=limit)return
   const wait=1000-(opts.now()-lastStart)
   if(wait>0){timer=opts.setTimer(()=>{timer=undefined;pump()},wait);return}
   let index=0
   for(let i=1;i<queued.length;i++)if((lastServed.get(queued[i].projectId)??0)<(lastServed.get(queued[index].projectId)??0))index=i
   const [job]=queued.splice(index,1)
   running.set(job.key,{job,cancelled:false});lastServed.set(job.projectId,++served);changed()
   try{job.start()}catch(error){running.delete(job.key);try{job.failed?.(error)}finally{changed()}}finally{lastStart=opts.now()}
  }finally{pumping=false;if(!disposed&&!paused&&queued.length&&running.size<limit&&timer===undefined)timer=opts.setTimer(()=>{timer=undefined;pump()},Math.max(0,1000-(opts.now()-lastStart)))}
 }
 return {
  enqueue(job:CliTurnJob):{ok:true}|{ok:false;reason:'disposed'|'duplicate'|'full'}{
   if(disposed)return {ok:false,reason:'disposed'}
   if(running.has(job.key)||queued.some(j=>j.key===job.key||j.sessionId===job.sessionId)||[...running.values()].some(e=>e.job.sessionId===job.sessionId))return {ok:false,reason:'duplicate'}
   if(queued.length>=128)return {ok:false,reason:'full'}
   queued.push({...job});changed();pump();return {ok:true}
  },
  cancel(key:string){const i=queued.findIndex(j=>j.key===key);if(i>=0){queued.splice(i,1);changed();pump();return}const r=running.get(key);if(r&&!r.cancelled){r.cancelled=true;changed();r.job.cancelRunning()}},
  finish(key:string){if(running.delete(key)){for(const project of lastServed.keys())if(!queued.some(j=>j.projectId===project)&&![...running.values()].some(e=>e.job.projectId===project))lastServed.delete(project);changed();pump()}},
  setLimit(value:number){if(!Number.isInteger(value)||value<1||value>8)throw Error('invalid CLI concurrency');limit=value;pump();changed()},
  getLimit:()=>limit,
  pause(){paused=true;clear();changed()},
  snapshot():readonly CliTurnEntry[]{
   const entries:CliTurnEntry[]=[...running.values()].map(({job,cancelled})=>({key:job.key,sessionId:job.sessionId,projectId:job.projectId,state:cancelled?'cancel-requested':'running',position:null}))
   return entries.concat(queued.map((job,i)=>({key:job.key,sessionId:job.sessionId,projectId:job.projectId,state:'queued',position:i+1})))
  },
  dispose(){disposed=true;clear();for(const job of queued.splice(0)){try{job.failed?.(Error('disposed'))}catch{/* observer */}}for(const r of running.values())if(!r.cancelled){r.cancelled=true;try{r.job.cancelRunning()}catch{/* retain until confirmed */}}changed()}
 }
}
