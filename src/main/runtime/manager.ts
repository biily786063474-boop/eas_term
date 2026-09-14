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
 /** 闸门是否生效。平台未校准（controller 判定）时置 false：只监测不拦，也不记预算。
  *  关死闸门会让 Windows / Intel Mac / 旧 macOS 上所有启动排队 60 秒后失败（2026-09-14 审查）。 */
 let enforcement=true
 const scheduler=createScheduler({now:opts.now,
  allow:()=>!enforcement||(metricsAvailable&&startsThisSample<1&&policy.allow(opts.now())),
  // 交互型只在严重压力下等；采样不可用时不能把控制面吊死
  allowInteractive:()=>!enforcement||!metricsAvailable||policy.decision(opts.now()).reason!=='critical-pressure',
  maxRunning:opts.maxRunning??4,maxQueued:128,waitTimeoutMs:opts.waitTimeoutMs,
  acquire:work=>{
   if(!enforcement)return {release(){}} // 闸门失效：空租约（null 会被调度器当成「预算不够、跳过」）
   const cost=costs.get(work.id)
   const lease=!cost?null:work.interactive?ledger.acquireForced(work.id,cost):latest?ledger.acquire(work.id,cost,{cpu:latest.cpu,memoryUsedBytes:latest.memoryUsedBytes,totalMemoryBytes:latest.totalMemoryBytes,threshold:mode==='eco'?50:80}):null
   if(lease&&!work.interactive)startsThisSample++
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
  async submitService(work:{id:string;projectId:string;cost:TaskCost;interactive?:boolean;start:(signal:AbortSignal)=>Promise<{completed:Promise<unknown>}>}):Promise<void>{
   if(services.has(work.id)||costs.has(work.id))throw Error('duplicate')
   const service:{held:boolean;release?:()=>void}={held:false};services.set(work.id,service)
   try{await submit({...work,run:async signal=>{
    const started=await work.start(signal)
    service.held=true
    ledger.settleCpu(work.id) // 启动完成：CPU 预留归零，驻留只占内存（空闲终端不占 CPU 额度）
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
  setEnforcement(next:boolean):void{if(enforcement===next)return;enforcement=next;scheduler.tick()},
  setMode(next:ResourceMode):void{
   if(next!=='normal'&&next!=='eco')throw new Error('invalid mode')
   mode=next;policy.setMode(mode);scheduler.tick()
  },
  submit(work:ManagedWork):Promise<void>{if(services.has(work.id))return Promise.reject(Error('duplicate'));return submit(work)},
  details:scheduler.details,tick:scheduler.tick,cancel:scheduler.cancel,dispose:scheduler.dispose,
  snapshot(){return Object.freeze({...scheduler.snapshot(),enforcement:(enforcement?'enabled':'disabled') as 'enabled'|'disabled',policyDecision:Object.freeze(metricsAvailable?policy.decision(opts.now()):{allowed:false,reason:'metrics-unavailable' as const}),mode,threshold:mode==='eco'?50:80,reserved:Object.freeze(ledger.reserved()),sample:latest?Object.freeze({...latest}):null})}
 }
}
