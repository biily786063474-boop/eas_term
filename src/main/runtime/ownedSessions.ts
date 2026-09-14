import type {RuntimeObservedService} from '../../shared/runtimeResources.ts'
import {recentActivity} from './recentActivity.ts'
interface OwnedSession {id:string;name:string;windowId:number;projectId:string|null;kind:'terminal'|'agent'|'voice'|'cli';completed:Promise<unknown>;stop:()=>void}
/** Main-owned process handles only. No caller PID, command, or ownership claims. */
export function createOwnedSessions(now:()=>number){
 const entries=new Map<string,OwnedSession&{at:number;stopping:boolean}>()
 return {
  add(input:OwnedSession){
   if(entries.has(input.id))throw Error('duplicate owned session')
   const entry={...input,at:now(),stopping:false};entries.set(input.id,entry)
   void input.completed.then(()=>{if(entries.get(input.id)===entry){entries.delete(input.id);recentActivity.record({id:input.id,name:input.name,windowId:input.windowId,projectId:input.projectId,kind:'service',outcome:'exited',startedAt:entry.at})}},()=>{/* Observation failure does not prove exit. */})
  },
  list(windowId:number):RuntimeObservedService[]{return [...entries.values()].filter(e=>e.windowId===windowId).map(e=>({id:e.id,name:e.name,kind:e.kind,projectIds:e.projectId?[e.projectId]:[],unknownRefs:0,uptimeMs:Math.max(0,now()-e.at),state:e.stopping?'stopping':'running',canStop:!e.stopping}))},
  async stop(id:string,windowId:number,confirm:(name:string,projects:string[])=>Promise<boolean>){
   const entry=entries.get(id)
   if(!entry||entry.windowId!==windowId||entry.stopping)return {ok:false,reason:'服务已结束或不属于当前窗口'}
   if(!await confirm(entry.name,entry.projectId?[entry.projectId]:[]))return {ok:false,reason:'已取消关闭'}
   if(entries.get(id)!==entry||entry.stopping)return {ok:false,reason:'服务状态已改变，请刷新'}
   entry.stopping=true
   try{entry.stop();return {ok:true}}catch{entry.stopping=false;return {ok:false,reason:'关闭请求失败，服务仍被跟踪'}}
  }
 }
}
export const ownedSessions=createOwnedSessions(()=>performance.now())
