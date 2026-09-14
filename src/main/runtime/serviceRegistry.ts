interface ServiceSpec {
 id:string;name:string;kind:string;projects:readonly string[]
 /** Adapter-owned handle, NEVER arbitrary renderer-supplied PID/command. */
 requestStop?:()=>Promise<void>
}
export interface StopConfirmation { readonly id:string; readonly generation:number; readonly ownerRevision:number; readonly expiresAt:number }
type State='running'|'stopping'|'stop-failed'|'stopped'
interface Entry {generation:number;ownerRevision:number;spec:ServiceSpec;startedAt:number;endedAt:number|null;state:State;pending:Promise<void>|null}
/** Observation registry, NOT a second HostRegistry lease manager.
 * Adapters must update owners from existing lease authority. No timers or PID scans.
 * Bounded retained entries; remove ended records explicitly before registering more.
 */
export function createServiceRegistry(now:()=>number,limit=512){
 if(!Number.isInteger(limit)||limit<1)throw new Error('invalid limit')
 const entries=new Map<string,Entry>()
 let generation=0
 const confirmations=new WeakSet<object>()
 return {
  register(spec:ServiceSpec){
   if(!spec.id||!spec.name||!spec.kind)throw new Error('invalid service')
   if(entries.has(spec.id))throw new Error('duplicate')
   if(entries.size>=limit)throw new Error('registry full')
   const at=now();if(!Number.isFinite(at))throw new Error('invalid clock')
   const entry:Entry={generation:++generation,ownerRevision:0,spec:{...spec,projects:[...new Set(spec.projects)]},startedAt:at,endedAt:null,state:'running',pending:null}
   entries.set(spec.id,entry)
   return {
    exited():void{if(entry.state!=='stopped'){entry.state='stopped';const end=now();entry.endedAt=Number.isFinite(end)?Math.max(entry.startedAt,end):entry.startedAt}},
    setProjects(projects:readonly string[]):void{
     const next=[...new Set(projects)]
     if(next.length===entry.spec.projects.length&&next.every(p=>entry.spec.projects.includes(p)))return
     entry.ownerRevision++;entry.spec={...entry.spec,projects:next}
    }
   }
  },
  /** Main-only confirmation scope, NOT a renderer authorization token.
   * Future IPC must verify caller access and mint this after user confirmation.
   */
  prepareStop(id:string):StopConfirmation{
   const entry=entries.get(id);if(!entry)throw new Error('unknown service')
   const at=now();if(!Number.isFinite(at))throw new Error('invalid clock')
   const token=Object.freeze({id,generation:entry.generation,ownerRevision:entry.ownerRevision,expiresAt:at+30000})
   confirmations.add(token);return token
  },
  async stop(id:string,confirmation?:StopConfirmation):Promise<void>{
   const entry=entries.get(id);if(!entry)throw new Error('unknown service')
   if(entry.state==='stopped')return
   if(!entry.spec.requestStop)throw new Error('read-only service')
   if(confirmation){
    if(typeof confirmation!=='object'||!confirmations.has(confirmation))throw new Error('invalid confirmation')
    if(confirmation.id!==id||confirmation.generation!==entry.generation)throw new Error('instance changed')
    if(confirmation.ownerRevision!==entry.ownerRevision)throw new Error('ownership changed')
    const at=now();if(!Number.isFinite(at)||at>confirmation.expiresAt)throw new Error('confirmation expired')
   }else if(entry.spec.projects.length>1)throw new Error('shared service requires confirmation')
   if(entry.pending)return entry.pending
   if(entry.state==='stopping')return
   if(confirmation)confirmations.delete(confirmation)
   const revision=entry.ownerRevision
   entry.state='stopping'
   const requestStop=entry.spec.requestStop
   entry.pending=Promise.resolve().then(()=>{
    if(entry.state==='stopped')return
    if(confirmation){const at=now();if(!Number.isFinite(at)||at>confirmation.expiresAt)throw new Error('confirmation expired')}
    if(entry.ownerRevision!==revision){entry.state='stop-failed';throw new Error('ownership changed')}
    try { return Promise.resolve(requestStop()).catch(()=>{throw new Error('stop failed')}) } catch { throw new Error('stop failed') }
   }).catch(error=>{
    if(entry.state!=='stopped'){entry.state='stop-failed';throw error}
   }).finally(()=>{entry.pending=null})
   return entry.pending
  },
  removeEnded(id:string):boolean{const e=entries.get(id);return !!e&&e.state==='stopped'&&entries.delete(id)},
  list(){const at=now();return Object.freeze([...entries.values()].map(e=>Object.freeze({
   id:e.spec.id,generation:e.generation,ownerRevision:e.ownerRevision,name:e.spec.name,kind:e.spec.kind,projects:Object.freeze([...e.spec.projects]),
   state:e.state,canStop:!!e.spec.requestStop&&e.state!=='stopped',
   uptimeMs:Math.max(0,(e.endedAt??(Number.isFinite(at)?at:e.startedAt))-e.startedAt)
  })))}
 }
}
