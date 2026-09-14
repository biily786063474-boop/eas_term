import {cpuBusyPercent,type CpuTicks} from './cpuMetrics.ts'
import type {RuntimeMonitorSnapshot} from '../../shared/runtimeResources.ts'
interface Reading {at:number;logicalCpus:number;totalMemoryBytes:number;memoryUsedBytes:number|null;memoryMethod:string;cpuTicks:CpuTicks[]}
export function createRuntimeMonitor(read:()=>Promise<Reading>,now:()=>number){
 let latest:RuntimeMonitorSnapshot|null=null,previous:Reading|null=null,pending:Promise<RuntimeMonitorSnapshot>|null=null
 return {read():Promise<RuntimeMonitorSnapshot>{
  if(pending)return pending
  if(latest&&now()>=latest.sampledAt&&now()-latest.sampledAt<2000)return Promise.resolve(latest)
  pending=read().then(r=>{
   const continuous=previous&&r.at>previous.at&&r.at-previous.at<=10000
   latest=Object.freeze({sampledAt:r.at,logicalCpus:r.logicalCpus,totalMemoryBytes:r.totalMemoryBytes,memoryUsedBytes:r.memoryUsedBytes,memoryMethod:r.memoryMethod,cpuPercent:cpuBusyPercent(continuous?previous!.cpuTicks:null,r.cpuTicks),enforcement:'disabled'})
   previous={...r,cpuTicks:r.cpuTicks.map(t=>({...t}))};return latest
  }).catch(()=>{previous=null;latest=null;throw new Error('资源读数暂不可用')}).finally(()=>{pending=null})
  return pending
 }}
}
