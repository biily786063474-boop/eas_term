import type {RuntimeObservedService} from '../../shared/runtimeResources.ts'
import {recentActivity} from './recentActivity.ts'
interface SharedService {id:string;name:string;kind:'language-server'|'voice';completed:Promise<unknown>;stop:()=>void}
/** References come only from main-owned window lifecycles. Never accepts caller PIDs. */
export function createSharedServices(now:()=>number){
 const entries=new Map<string,SharedService&{at:number;stopping:boolean;refs:Map<number,string|null>}>()
 function stopEntry(e:SharedService&{stopping:boolean}){if(e.stopping)return;e.stopping=true;try{e.stop()}catch(error){e.stopping=false;throw error}}
 return {
  add(input:SharedService){
   if(entries.has(input.id))throw Error('duplicate shared service')
   const e={...input,at:now(),stopping:false,refs:new Map<number,string|null>()};entries.set(e.id,e)
   void e.completed.then(()=>{if(entries.get(e.id)!==e)return;entries.delete(e.id);for(const [windowId,projectId] of e.refs)recentActivity.record({id:e.id,name:e.name,windowId,projectId,kind:'service',outcome:'exited',startedAt:e.at})},()=>{/* Failed observation is not exit. */})
  },
  retain(id:string,windowId:number,projectId:string|null){const e=entries.get(id);if(!e||e.stopping)return false;e.refs.set(windowId,projectId);return true},
  shutdown(){for(const e of entries.values())try{stopEntry(e)}catch{/* Keep failed handles tracked. */}},
  /** 移除项目：释放该项目的全部窗口引用；引用清零才停（别的项目仍持有的不动）。返回真正停掉的服务 id。 */
  releaseProject(projectId:string):string[]{
   const stopped:string[]=[]
   for(const e of entries.values()){
    let dropped=false
    for(const [windowId,pid] of [...e.refs])if(pid===projectId){e.refs.delete(windowId);dropped=true}
    if(dropped&&!e.refs.size){try{stopEntry(e);stopped.push(e.id)}catch{/* Retain tracked state on stop failure. */}}
   }
   return stopped
  },
  releaseWindow(windowId:number){for(const e of entries.values()){if(!e.refs.delete(windowId))continue;if(!e.refs.size)try{stopEntry(e)}catch{/* Retain tracked state on stop failure. */}}},
  list(windowId:number):RuntimeObservedService[]{return [...entries.values()].filter(e=>e.refs.has(windowId)).map(e=>({id:e.id,name:e.name,kind:e.kind,projectIds:[...new Set([...e.refs.values()].filter((p):p is string=>p!==null))],unknownRefs:[...e.refs.values()].filter(p=>p===null).length,uptimeMs:Math.max(0,now()-e.at),state:e.stopping?'stopping':'running',canStop:!e.stopping&&e.refs.size===1}))},
  async stop(id:string,windowId:number,confirm:(name:string,projects:string[])=>Promise<boolean>){
   const e=entries.get(id)
   const allowed=()=>entries.get(id)===e&&e?.refs.has(windowId)&&e.refs.size===1&&!e.stopping
   if(!e||!allowed())return {ok:false,reason:'服务共享、已结束或不属于当前窗口'}
   if(!await confirm(e.name,[...e.refs.values()].filter((p):p is string=>p!==null)))return {ok:false,reason:'已取消关闭'}
   if(!allowed())return {ok:false,reason:'服务引用已改变，请刷新'}
   try{stopEntry(e);return {ok:true}}catch{return {ok:false,reason:'关闭失败，服务仍被跟踪'}}
  }
 }
}
export const sharedServices=createSharedServices(()=>performance.now())
