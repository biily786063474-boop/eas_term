interface DriverDeps<T>{
 read:()=>Promise<T>
 update:(sample:T)=>void
 invalidate:()=>void
 tick:()=>void
 dispose:()=>void
 setTimer:(fn:()=>void,ms:number)=>unknown
 clearTimer:(handle:unknown)=>void
}
/** Explicit, terminal lifecycle. Sampling is serial; maintenance never awaits it.
 * Import/construction starts nothing. Only validated adapters may feed admission.
 * dispose fences late results but cannot cancel arbitrary reader I/O; adapters must
 * bound their own I/O (the platform reader has a timeout).
 */
export function createRuntimeDriver<T>(deps:DriverDeps<T>){
 let active=false,disposed=false,sampleTimer:unknown=null,maintenanceTimer:unknown=null
 const sample=async()=>{
  if(!active)return
  sampleTimer=null
  try{const value=await deps.read();if(active)deps.update(value)}
  catch{if(active){try{deps.invalidate()}catch{/* isolate adapter fault */}}}
  finally{if(active)sampleTimer=deps.setTimer(()=>{void sample()},1000)}
 }
 const maintain=()=>{
  maintenanceTimer=null
  if(!active)return
  try{deps.tick()}catch{/* A maintenance fault must not crash the application timer. */}finally{if(active)maintenanceTimer=deps.setTimer(maintain,1000)}
 }
 return {
  start(){
   if(disposed)throw new Error('disposed')
   if(active)return
   active=true;maintenanceTimer=deps.setTimer(maintain,1000);void sample()
  },
  dispose(){
   if(disposed)return
   disposed=true;active=false
   if(sampleTimer!==null)deps.clearTimer(sampleTimer)
   if(maintenanceTimer!==null)deps.clearTimer(maintenanceTimer)
   sampleTimer=maintenanceTimer=null;deps.dispose()
  }
 }
}
