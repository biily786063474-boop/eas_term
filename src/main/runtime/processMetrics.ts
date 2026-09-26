import type {ElectronProcessSnapshot} from '../../shared/runtimeResources.ts'
interface Metric {memory?:{workingSetSize?:number;peakWorkingSetSize?:number};cpu?:{percentCPUUsage?:number}}
/** Opt-in, bounded cache. No PID, names, paths, command lines or content cross IPC.
 * Electron only: spawned CLI/plugin processes are NOT counted here.
 */
export function createProcessMetricsReader(now:()=>number,read:()=>readonly Metric[]){
 let at:number|null=null,cached:ElectronProcessSnapshot|null=null
 return ():ElectronProcessSnapshot|null=>{
  const time=now()
  if(!Number.isFinite(time))return null
  if(at!==null&&time>=at&&time-at<5000)return cached?{...cached}:null
  at=time
  try{
   const metrics=read()
   const sum=(get:(m:Metric)=>number|undefined,scale=1):number|null=>{
    let total=0
    if(!metrics.length)return null
    for(const m of metrics){const value=get(m);if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;total+=value*scale}
    return Number.isFinite(total)?total:null
   }
   cached={sampledAt:time,scope:'electron-only',processCount:metrics.length,
    workingSetBytes:sum(m=>m.memory?.workingSetSize,1024),reportedPeakSumBytes:sum(m=>m.memory?.peakWorkingSetSize,1024),cpuPercent:sum(m=>m.cpu?.percentCPUUsage)}
  }catch{cached=null}
  return cached?{...cached}:null
 }
}
