import {AsyncLocalStorage} from 'node:async_hooks'
import type { ResourceLease } from './resourceLedger.ts'
export interface TaskDetail {readonly id:string;readonly projectId:string;readonly state:'queued'|'running'|'cancel-requested';readonly ageMs:number|null}
export interface Work {
 id: string
 projectId: string
 run: (signal: AbortSignal) => Promise<void>
}
interface Entry {
 lease?: ResourceLease
 work: Work; enqueuedAt: number; controller: AbortController
 resolve: () => void; reject: (error: unknown) => void
}
interface Options {
 acquire?: (work:Work)=>ResourceLease|null
 allow: () => boolean; now: () => number; maxRunning: number; maxQueued: number; waitTimeoutMs?: number
}
/** Bounded non-persistent queue foundation. No automatic retries, process kills or timers.
 * Caller ticks on fresh samples; NEVER put a parent job waiting for its nested jobs
 * in this same pool. Nested permit handoff is not implemented yet.
 */
export function createScheduler(opts: Options) {
 if (![opts.maxRunning,opts.maxQueued].every(n=>Number.isInteger(n)&&n>0)) throw new Error('invalid limits')
 const timeout = opts.waitTimeoutMs ?? 60000
 if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('invalid timeout')
 const execution=new AsyncLocalStorage<Entry>()
 const queue: Entry[] = [], running = new Map<string, Entry>()
 let disposed = false, pumping = false, lastProject: string | null = null
 const rejectQueued = (index: number, reason: string) => { const [entry]=queue.splice(index,1);entry.reject(new Error(reason)) }
 const pump = (): void => {
  if (disposed || pumping) return
  pumping = true
  try {
   const now = opts.now()
   if (!Number.isFinite(now)) return
   for(let i=queue.length-1;i>=0;i--) if(now-queue[i].enqueuedAt>=timeout) rejectQueued(i,'wait timeout')
   while(queue.length && running.size<opts.maxRunning) {
    let allowed=false
    try { allowed=opts.allow() } catch { /* monitoring error fails closed */ }
    if(!allowed)break
    // Prefer another project, but a non-fitting candidate must not block the pool.
    // Each bounded queue entry is attempted at most once per admission scan.
    const indexes=queue.map((_,i)=>i)
    const ordered=[...indexes.filter(i=>queue[i].work.projectId!==lastProject),...indexes.filter(i=>queue[i].work.projectId===lastProject)]
    let index=-1
    for(const candidateIndex of ordered){
     const candidate=queue[candidateIndex]
     if(opts.acquire){
      let lease:ResourceLease|null=null
      try {lease=opts.acquire(candidate.work)} catch { /* fail this candidate closed */ }
      if(!lease)continue
      candidate.lease=lease
     }
     index=candidateIndex;break
    }
    if(index<0)break
    const [entry]=queue.splice(index,1)
    lastProject=entry.work.projectId;running.set(entry.work.id,entry)
    // Reserve synchronously before executing user work or yielding to microtasks.
    void Promise.resolve().then(()=> {
     if(entry.controller.signal.aborted)throw new Error('cancelled')
     return execution.run(entry,()=>entry.work.run(entry.controller.signal))
    }).then(()=>finish(entry),error=>finish(entry,error,true))
   }
  } finally { pumping=false }
 }
 const finish=(entry: Entry,error?:unknown,failed=false):void=>{
  entry.lease?.release()
  running.delete(entry.work.id)
  if(failed)entry.reject(error);else entry.resolve()
  pump()
 }
 return {
  submit(work:Work):Promise<void>{
   if(disposed)return Promise.reject(new Error('disposed'))
   const parent=execution.getStore()
   if(parent&&running.get(parent.work.id)===parent)return Promise.reject(new Error('nested admission unsupported: parent must not wait for work in the same pool'))
   if(!work.id||!work.projectId)return Promise.reject(new Error('invalid identity'))
   if(running.has(work.id)||queue.some(e=>e.work.id===work.id))return Promise.reject(new Error('duplicate'))
   if(queue.length>=opts.maxQueued)return Promise.reject(new Error('queue full'))
   const at=opts.now();if(!Number.isFinite(at))return Promise.reject(new Error('invalid clock'))
   // Snapshot metadata so caller mutation cannot defeat deduplication/release.
   const result=new Promise<void>((resolve,reject)=>queue.push({work:{...work},enqueuedAt:at,controller:new AbortController(),resolve,reject}))
   pump();return result
  },
  tick:pump,
  cancel(id:string):boolean{
   const index=queue.findIndex(e=>e.work.id===id)
   if(index>=0){rejectQueued(index,'cancelled');return true}
   const entry=running.get(id);if(!entry)return false
   entry.controller.abort();return true
  },
  dispose():void{
   disposed=true
   while(queue.length)rejectQueued(0,'disposed')
   for(const entry of running.values())entry.controller.abort()
  },
  /** Metadata only: age is since submission, NOT process uptime. Unknown clock stays null. */
  details():readonly TaskDetail[]{
   const now=opts.now()
   const describe=(entry:Entry,state:TaskDetail['state']):TaskDetail=>Object.freeze({id:entry.work.id,projectId:entry.work.projectId,state,ageMs:Number.isFinite(now)&&now>=entry.enqueuedAt?now-entry.enqueuedAt:null})
   return Object.freeze([...running.values()].map(entry=>describe(entry,entry.controller.signal.aborted?'cancel-requested':'running')).concat(queue.map(entry=>describe(entry,'queued'))))
  },
  snapshot(){return Object.freeze({running:running.size,queued:queue.length,disposed})}
 }
}
