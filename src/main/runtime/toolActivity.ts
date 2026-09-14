import type {createRuntimeManager} from './manager.ts'
import {recentActivity,outcomeOfError} from './recentActivity.ts'
import type {TaskCost} from './resourceLedger.ts'
/** Main-owned metadata only. Caller timeout is not execution completion.
 * Window authority comes from the existing panel lease, never RPC arguments.
 */
interface Owner {id:string;name:string;projectId:string|null;windowId:number|null;sourceKey?:string}
interface Call {result:Promise<unknown>;completed:Promise<unknown>;cancel():void}
export function createToolActivity(now:()=>number){
 let admission:ReturnType<typeof createRuntimeManager>|null=null,cost:(()=>TaskCost)|null=null
 const entries=new Map<string,{owner:Owner;at:number;call:Call;cancelled:boolean}>()
 return {
  setAdmission(manager:ReturnType<typeof createRuntimeManager>,estimate:()=>TaskCost){if(admission)throw Error('admission already installed');admission=manager;cost=estimate},
  async track(owner:Owner,start:()=>Call):Promise<unknown>{
   if(entries.has(owner.id))throw Error('duplicate activity')
   let call:Call
   if(admission&&cost){
    const manager=admission
    let resolveResult!:(value:unknown)=>void,rejectResult!:(error:unknown)=>void
    const result=new Promise<unknown>((resolve,reject)=>{resolveResult=resolve;rejectResult=reject})
    const completed=manager.submit({id:owner.id,projectId:owner.projectId??'unattributed',cost:cost(),run:async signal=>{
     if(signal.aborted)throw Error('cancelled')
     const actual=start(),cancel=()=>actual.cancel()
     signal.addEventListener('abort',cancel,{once:true})
     void actual.result.then(resolveResult,rejectResult)
     try{await actual.completed}finally{signal.removeEventListener('abort',cancel)}
    }})
    void completed.catch(rejectResult)
    call={result,completed,cancel:()=>{manager.cancel(owner.id)}}
   }else call=start()
   const entry={owner:{...owner},at:now(),call,cancelled:false}
   entries.set(owner.id,entry)
   const remove=(outcome:ReturnType<typeof outcomeOfError>|'done')=>{if(entries.get(owner.id)!==entry)return;entries.delete(owner.id);recentActivity.record({id:owner.id,name:owner.name,windowId:owner.windowId,projectId:owner.projectId,kind:'task',outcome:entry.cancelled?'cancelled':outcome,startedAt:entry.at})}
   void call.completed.then(()=>remove('done'),e=>remove(outcomeOfError(e)))
   return call.result
  },
  list(windowId:number){const details=admission?.details()??[];const reason=admission?.snapshot().policyDecision.reason;const byId=new Map(details.map(d=>[d.id,d]));return [...entries.values()].filter(e=>e.owner.windowId===windowId).map(e=>({id:e.owner.id,name:e.owner.name,projectId:e.owner.projectId,ageMs:Math.max(0,now()-e.at),state:e.cancelled?'cancel-requested' as const:admission?.details().find(t=>t.id===e.owner.id)?.state??'running' as const,reason:reason}))},
  /** Main-only source identity; not a renderer-supplied cancellation capability. */
  closeSource(sourceKey:string){
   for(const e of entries.values())if(e.owner.sourceKey===sourceKey&&!e.cancelled){e.call.cancel();e.cancelled=true}
  },
  cancel(id:string,windowId:number){
   const e=entries.get(id)
   if(!e||e.owner.windowId===null||e.owner.windowId!==windowId)return false
   if(!e.cancelled){e.call.cancel();e.cancelled=true}
   return true
  }
 }
}
