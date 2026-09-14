/** Caller deadlines never prove that synchronous work in a worker has stopped. */
export function createWorkerRequests<T>(capacity:number){
 const entries=new Map<number,{owner:object;resolve:(value:T|null)=>void;finish:()=>void;timer:ReturnType<typeof setTimeout>}>()
 function settle(id:number,owner:object,value:T|null){const e=entries.get(id);if(!e||e.owner!==owner)return false;entries.delete(id);clearTimeout(e.timer);e.resolve(value);e.finish();return true}
 return {
  get size(){return entries.size},
  begin(id:number,owner:object,timeoutMs:number){
   if(entries.has(id)||entries.size>=capacity)return null
   let resolve!:(value:T|null)=>void,finish!:()=>void
   const result=new Promise<T|null>(r=>resolve=r),completed=new Promise<void>(r=>finish=r)
   const timer=setTimeout(()=>resolve(null),timeoutMs)
   entries.set(id,{owner,resolve,finish,timer});return {result,completed}
  },
  settle,
  failOwner(owner:object){for(const [id,e] of entries)if(e.owner===owner)settle(id,owner,null)}
 }
}
