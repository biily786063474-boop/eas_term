import {createCliTurnQueue} from './cliTurnQueue.ts'
const listeners=new Set<()=>void>()
const owners=new Map<string,{windowId:number;name:string;at:number;cancel:()=>void}>()
export const cliTurnQueue=createCliTurnQueue({now:()=>performance.now(),setTimer:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t},clearTimer:t=>clearTimeout(t as NodeJS.Timeout),changed:()=>{const keys=new Set(cliTurnQueue.snapshot().map(e=>e.key));for(const key of owners.keys())if(!keys.has(key))owners.delete(key);for(const fn of listeners){try{fn()}catch{/* isolate observers */}}}})
export function onCliDispatchChange(fn:()=>void):()=>void{listeners.add(fn);return ()=>{listeners.delete(fn)}}
let sequence=0
/** Cancellation is only of admission. Once started, transport owns stopping and completion. */
export function admitCliTurn(opts:{sessionId:string;projectId:string;windowId?:number;name?:string;signal:AbortSignal;start:(key:string)=>void;cancelRunning:()=>void}):Promise<string>{
 const key=opts.sessionId+':'+(++sequence)
 return new Promise((resolve,reject)=>{
  if(opts.signal.aborted){reject(Error('已取消等待调度'));return}
  const abort=()=>{cliTurnQueue.cancel(key);reject(Error('已取消等待调度'))}
  opts.signal.addEventListener('abort',abort,{once:true})
  owners.set(key,{windowId:opts.windowId??-1,name:opts.name??'AI 任务',at:performance.now(),cancel:()=>{if(cliTurnQueue.snapshot().find(e=>e.key===key)?.state==='queued')abort();else opts.cancelRunning()}})
  const result=cliTurnQueue.enqueue({...opts,key,start:()=>{
   opts.signal.removeEventListener('abort',abort)
   if(opts.signal.aborted){cliTurnQueue.finish(key);reject(Error('已取消等待调度'));return}
   opts.start(key);resolve(key)
  },failed:error=>{opts.signal.removeEventListener('abort',abort);reject(error)}})
  if(!result.ok){owners.delete(key);opts.signal.removeEventListener('abort',abort);reject(Error(result.reason==='full'?'AI 任务队列已满，请稍后重试':'此会话已有等待或运行任务'))}
 })
}

export function cliDispatchTasks(windowId:number){return cliTurnQueue.snapshot().flatMap(e=>{const o=owners.get(e.key);return o?.windowId===windowId?[{id:'cli-turn:'+e.key,name:o.name,projectId:e.projectId,ageMs:Math.max(0,performance.now()-o.at),state:e.state,reason:e.state==='queued'?'cli-dispatch':undefined}]:[]})}
export function cancelCliDispatchTask(id:string,windowId:number):boolean{if(!id.startsWith('cli-turn:'))return false;const o=owners.get(id.slice(9));if(!o||o.windowId!==windowId)return false;o.cancel();return true}
