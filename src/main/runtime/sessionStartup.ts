import type {createRuntimeManager} from './manager.ts'
import type {TaskCost} from './resourceLedger.ts'
import {recentActivity,outcomeOfError} from './recentActivity.ts'
let manager:ReturnType<typeof createRuntimeManager>|null=null
/** windowId 为 null = 应用自己发起的任务（CLI 更新下载等）：所有窗口可见，任何窗口都无权取消，窗口关闭不带走它。 */
const owners=new Map<string,{windowId:number|null;sharedWindows?:Set<number>;name:string;projectId:string|null;at:number}>()
/** Installed by main bootstrap. No timer or process work at import time. */
export function installSessionStartup(value:ReturnType<typeof createRuntimeManager>){if(manager)throw Error('startup manager already installed');manager=value}
export async function startManagedSession<T>(opts:{id:string;windowId:number|null;sharedWindows?:Set<number>;name:string;projectId:string|null;cost:TaskCost;start:(signal:AbortSignal)=>Promise<{value:T;completed:Promise<unknown>}>}):Promise<T>{
 if(!manager)throw Error('资源管理器尚未就绪')
 if(owners.has(opts.id))throw Error('duplicate startup')
 const m=manager
 owners.set(opts.id,{windowId:opts.windowId,sharedWindows:opts.sharedWindows,name:opts.name,projectId:opts.projectId,at:performance.now()})
 let value!:T
 try{await m.submitService({...opts,projectId:opts.projectId??'unattributed',start:async signal=>{const r=await opts.start(signal);value=r.value;return {completed:r.completed}}});return value}
 finally{owners.delete(opts.id)}
}
export function queuedSessionStarts(windowId:number){
 if(!manager)return []
 return manager.details().flatMap(t=>{const o=owners.get(t.id);return (o&&(o.windowId===null||(o.sharedWindows?o.sharedWindows.has(windowId):o.windowId===windowId)))?[{id:t.id,name:o.name,projectId:o.projectId,...(o.windowId===null?{scope:'app' as const}:{}),ageMs:Math.max(0,performance.now()-o.at),state:t.state,reason:manager!.snapshot().policyDecision.reason}]:[]})
}
export function cancelSessionStart(id:string,windowId:number){
 const owner=owners.get(id)
 if(owner?.windowId===null)return false // 应用级任务不归任何窗口，窗口无权取消
 const allowed=owner&&(owner.sharedWindows?owner.sharedWindows.size===1&&owner.sharedWindows.has(windowId):owner.windowId===windowId)
 return allowed?(manager?.cancel(id)??false):false
}
/** Window teardown releases a shared reference, not other windows' work. */
export function cancelSessionStartsForWindow(windowId:number):void{
 for(const [id,owner] of owners){
  if(owner.windowId===null)continue // 应用级任务不随窗口关闭取消
  if(owner.sharedWindows){if(owner.sharedWindows.delete(windowId)&&!owner.sharedWindows.size)manager?.cancel(id)}
  else if(owner.windowId===windowId)manager?.cancel(id)
 }
}
/** Caller-facing result and actual completion are independent (e.g. worker timeout). */
export function runManagedTask<T>(opts:{id:string;windowId:number|null;name:string;projectId:string|null;cost:TaskCost;start:(signal:AbortSignal)=>Promise<{result:Promise<T>;completed:Promise<void>}>}):Promise<T>{
 if(!manager)return Promise.reject(Error('资源管理器尚未就绪'))
 if(owners.has(opts.id))return Promise.reject(Error('duplicate task'))
 const m=manager
 owners.set(opts.id,{windowId:opts.windowId,name:opts.name,projectId:opts.projectId,at:performance.now()})
 const startedAt=performance.now()
 const settle=(outcome:ReturnType<typeof outcomeOfError>|'done')=>recentActivity.record({id:opts.id,name:opts.name,windowId:opts.windowId,projectId:opts.projectId,kind:'task',outcome,startedAt})
 return new Promise<T>((resolve,reject)=>{
  void m.submit({...opts,projectId:opts.projectId??'unattributed',run:async signal=>{
   const cancelled=()=>reject(Error('cancelled'))
   signal.addEventListener('abort',cancelled,{once:true})
   try {
    if(signal.aborted){cancelled();return}
    const work=await opts.start(signal)
    void work.result.then(value=>signal.aborted?cancelled():resolve(value),reject)
    // Cancelling the caller does not prove synchronous worker work has stopped.
    // An observation error cannot prove exit either; retain the actual lease.
    await new Promise<void>(done=>{void work.completed.then(done,()=>{})})
   } finally {signal.removeEventListener('abort',cancelled)}
  }}).catch(reject).finally(()=>owners.delete(opts.id))
 }).then(v=>{settle('done');return v},e=>{settle(outcomeOfError(e));throw e})
}
/** 应用自己发起、没有窗口归属的后台任务（CLI 更新下载/校验）。同一调度器、同一预算账本；
 *  区别只在所有权：所有窗口可见（scope:'app'），没有窗口能取消它，窗口关闭也不带走它。
 *  不放进普通 runManagedTask 的原因：那条路的取消/投影都以窗口为权限单位，混用会让
 *  某个窗口"看起来"能取消一件不属于它的事。 */
export function runAppTask<T>(opts:{id:string;name:string;cost:TaskCost;start:(signal:AbortSignal)=>Promise<{result:Promise<T>;completed:Promise<void>}>}):Promise<T>{
 return runManagedTask<T>({...opts,windowId:null,projectId:null})
}
