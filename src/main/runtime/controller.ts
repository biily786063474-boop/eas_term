import type {ResourceMode} from './policy.ts'
import {createRuntimeDriver} from './driver.ts'
import {createRuntimeManager} from './manager.ts'
import {cpuBusyPercent,type CpuTicks} from './cpuMetrics.ts'
import type {RuntimeMonitorSnapshot} from '../../shared/runtimeResources.ts'
interface Reading {at:number;logicalCpus:number;totalMemoryBytes:number;memoryUsedBytes:number|null;memoryMethod:string;memoryAdmissionVerified:boolean;memoryPressure?:'normal'|'warning'|'critical'|null;cpuTicks:CpuTicks[]}
/** One application-owned sampler/manager. Rendering only reads cached snapshots.
 * Unverified platform memory is shown as estimated but NEVER passed to admission.
 * Constructor has no I/O; application bootstrap explicitly starts and disposes it.
 */
export function createRuntimeController(deps:{mode?:ResourceMode;now:()=>number;read:()=>Promise<Reading>;setTimer:(fn:()=>void,ms:number)=>unknown;clearTimer:(handle:unknown)=>void;onQueueChange?:()=>void}){
 const manager=createRuntimeManager({now:deps.now,mode:deps.mode,maxRunning:1,onChange:deps.onQueueChange})
 let previous:Reading|null=null,latest:RuntimeMonitorSnapshot|null=null
 const driver=createRuntimeDriver({read:deps.read,setTimer:deps.setTimer,clearTimer:deps.clearTimer,tick:manager.tick,dispose:manager.dispose,
  invalidate:()=>{previous=null;manager.invalidateMetrics()},
  update:r=>{
   const continuous=previous&&r.at>previous.at&&r.at-previous.at<=10000
   const cpu=cpuBusyPercent(continuous?previous!.cpuTicks:null,r.cpuTicks)
   latest=Object.freeze({sampledAt:r.at,logicalCpus:r.logicalCpus,totalMemoryBytes:r.totalMemoryBytes,memoryUsedBytes:r.memoryUsedBytes,memoryMethod:r.memoryMethod,cpuPercent:cpu,enforcement:'plugin-tools'})
   previous={...r,cpuTicks:r.cpuTicks.map(t=>({...t}))}
   // 未校准平台：闸门失效（只监测不拦），估算读数不进准入。关死闸门 = 所有启动排队 60 秒后失败（2026-09-14 审查）。
   manager.setEnforcement(r.memoryAdmissionVerified)
   if(r.memoryAdmissionVerified)manager.update({at:r.at,cpu,memoryUsedBytes:r.memoryUsedBytes,totalMemoryBytes:r.totalMemoryBytes,critical:r.memoryPressure==='critical'})
   else manager.invalidateMetrics()
  }
 })
 return {readForControl():RuntimeMonitorSnapshot{
   const now=deps.now(),fresh=!!latest&&previous!==null&&Number.isFinite(now)&&now>=latest.sampledAt&&now-latest.sampledAt<=5000
   const policy=manager.snapshot()
   return {...(latest??{sampledAt:0,logicalCpus:0,totalMemoryBytes:0,memoryMethod:'unavailable',enforcement:'plugin-tools' as const}),
    metricsAvailable:fresh,cpuPercent:fresh?latest!.cpuPercent:null,memoryUsedBytes:fresh?latest!.memoryUsedBytes:null,mode:policy.mode,threshold:policy.threshold,enforcement:(policy.enforcement==='disabled'?'disabled':'plugin-tools') as 'disabled'|'plugin-tools'}
  },manager,setMode:manager.setMode,start:driver.start,dispose:driver.dispose,snapshot:manager.snapshot,
  read():RuntimeMonitorSnapshot{const now=deps.now();if(!latest||previous===null||!Number.isFinite(now)||now<latest.sampledAt||now-latest.sampledAt>5000)throw Error('资源读数暂不可用');return {...latest,mode:manager.snapshot().mode,threshold:manager.snapshot().threshold}}
 }
}
