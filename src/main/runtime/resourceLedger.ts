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
  }
 }
}
