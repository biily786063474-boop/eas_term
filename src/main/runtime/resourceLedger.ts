export interface TaskCost { cpu:number; memoryBytes:number }
export interface BudgetView { cpu:number|null; memoryUsedBytes:number|null; totalMemoryBytes:number; threshold:number }
export interface ResourceLease { release():void }
/** Conservative uncredited reservations: observed workload is NOT subtracted
 * without attribution evidence. Can underutilize, never silently assume credit.
 */
export function createResourceLedger(){
 const entries=new Map<string,TaskCost>()
 const reserved=():TaskCost=>{let cpu=0,memoryBytes=0;for(const e of entries.values()){cpu+=e.cpu;memoryBytes+=e.memoryBytes}return {cpu,memoryBytes}}
 return {
  reserved,
  acquire(id:string,cost:TaskCost,view:BudgetView):ResourceLease|null{
   if(!id||entries.has(id)||view.cpu===null||view.memoryUsedBytes===null)return null
   if(![cost.cpu,cost.memoryBytes,view.cpu,view.memoryUsedBytes,view.totalMemoryBytes,view.threshold].every(n=>Number.isFinite(n)&&n>=0))return null
   if(view.totalMemoryBytes<=0||view.threshold<=0||view.threshold>100||view.cpu>100||cost.cpu>100||view.memoryUsedBytes>view.totalMemoryBytes)return null
   const used=reserved()
   if(view.cpu+used.cpu+cost.cpu>=view.threshold||view.memoryUsedBytes+used.memoryBytes+cost.memoryBytes>=view.totalMemoryBytes*view.threshold/100)return null
   const entry={...cost};entries.set(id,entry)
   return {release(){if(entries.get(id)===entry)entries.delete(id)}}
  },
  /** 交互型启动：不比阈值，但仍记账（让后台重任务看得见它）。 */
  acquireForced(id:string,cost:TaskCost):ResourceLease|null{
   if(!id||entries.has(id)||![cost.cpu,cost.memoryBytes].every(n=>Number.isFinite(n)&&n>=0))return null
   const entry={...cost};entries.set(id,entry)
   return {release(){if(entries.get(id)===entry)entries.delete(id)}}
  },
  /** 服务启动完成：CPU 预留是给启动那一下的，驻留只占内存。空闲终端不该一直占着一份 CPU 额度。 */
  settleCpu(id:string):void{const e=entries.get(id);if(e)e.cpu=0}
 }
}
