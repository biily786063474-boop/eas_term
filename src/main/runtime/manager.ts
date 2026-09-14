import { createResourcePolicy, type ResourceMode } from './policy.ts'
import { createResourceLedger, type TaskCost } from './resourceLedger.ts'
import { createScheduler, type Work } from './scheduler.ts'
export interface RuntimeSample {at:number;cpu:number|null;memoryUsedBytes:number|null;totalMemoryBytes:number;critical:boolean}
export interface ManagedWork extends Work {cost:TaskCost}
/** Main-only assembly. One manager per application, instantiated by bootstrap later.
 * Adapter supplies validated memory bytes; does not guess memory from os.freemem.
 * No IPC, auto-start timer, persisted tasks, secrets or executable strings.
 */
export function createRuntimeManager(opts:{now:()=>number;mode?:ResourceMode;waitTimeoutMs?:number;maxRunning?:number}){
 let mode:ResourceMode=opts.mode??'normal', latest:RuntimeSample|null=null
 const policy=createResourcePolicy(mode),ledger=createResourceLedger()
 const services=new Map<string,{held:boolean;release?:()=>void}>()
 const costs=new Map<string,TaskCost>()
 let startsThisSample=0,metricsAvailable=false
 const scheduler=createScheduler({now:opts.now,allow:()=>metricsAvailable&&startsThisSample<1&&policy.allow(opts.now()),maxRunning:opts.maxRunning??4,maxQueued:128,waitTimeoutMs:opts.waitTimeoutMs,
  acquire:work=>{
   const cost=costs.get(work.id)
   const lease=cost&&latest?ledger.acquire(work.id,cost,{cpu:latest.cpu,memoryUsedBytes:latest.memoryUsedBytes,totalMemoryBytes:latest.totalMemoryBytes,threshold:mode==='eco'?50:80}):null
   if(lease)startsThisSample++
   const service=services.get(work.id)
   if(lease&&service){service.release=lease.release;return {release(){if(!service.held)lease.release()}}}
   return lease
  }
 })
 const submit=(work:ManagedWork):Promise<void>=>{
  if(!work.cost||![work.cost.cpu,work.cost.memoryBytes].every(n=>Number.isFinite(n)&&n>=0)||work.cost.cpu>100)return Promise.reject(new Error('invalid cost'))
  if(costs.has(work.id))return Promise.reject(new Error('duplicate'))
  costs.set(work.id,{...work.cost})
  return scheduler.submit(work).finally(()=>{costs.delete(work.id)})
 }
 return {
  async submitService(work:{id:string;projectId:string;cost:TaskCost;start:(signal:AbortSignal)=>Promise<{completed:Promise<unknown>}>}):Promise<void>{
   if(services.has(work.id)||costs.has(work.id))throw Error('duplicate')
   const service:{held:boolean;release?:()=>void}={held:false};services.set(work.id,service)
   try{await submit({...work,run:async signal=>{
    const started=await work.start(signal)
    service.held=true
    const release=()=>{service.release?.();services.delete(work.id);scheduler.tick()}
    void started.completed.then(release,()=>{/* Observer failure is not proof that the process exited. */})
   }})}catch(error){service.release?.();services.delete(work.id);throw error}
  },
  update(input:RuntimeSample):void{
   const now=opts.now()
   if(!Number.isFinite(input.at)||!Number.isFinite(now)||input.at>now){metricsAvailable=false;scheduler.tick();return}
   if(!Number.isFinite(input.at)||(latest&&input.at<=latest.at))return
   latest={...input};startsThisSample=0;metricsAvailable=true
   const memory=input.memoryUsedBytes!==null&&Number.isFinite(input.totalMemoryBytes)&&input.totalMemoryBytes>0&&Number.isFinite(input.memoryUsedBytes)&&input.memoryUsedBytes>=0&&input.memoryUsedBytes<=input.totalMemoryBytes?100*input.memoryUsedBytes/input.totalMemoryBytes:null
   policy.update({at:input.at,cpu:input.cpu,memory,critical:input.critical});scheduler.tick()
  },
  invalidateMetrics():void{metricsAvailable=false;scheduler.tick()},
  setMode(next:ResourceMode):void{
   if(next!=='normal'&&next!=='eco')throw new Error('invalid mode')
   mode=next;policy.setMode(mode);scheduler.tick()
  },
  submit(work:ManagedWork):Promise<void>{if(services.has(work.id))return Promise.reject(Error('duplicate'));return submit(work)},
  details:scheduler.details,tick:scheduler.tick,cancel:scheduler.cancel,dispose:scheduler.dispose,
  snapshot(){return Object.freeze({...scheduler.snapshot(),policyDecision:Object.freeze(metricsAvailable?policy.decision(opts.now()):{allowed:false,reason:'metrics-unavailable' as const}),mode,threshold:mode==='eco'?50:80,reserved:Object.freeze(ledger.reserved()),sample:latest?Object.freeze({...latest}):null})}
 }
}
