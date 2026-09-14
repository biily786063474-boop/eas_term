import type {RuntimeRecentItem} from '../../shared/runtimeResources.ts'

export type RecentOutcome = RuntimeRecentItem['outcome']
interface Recorded { id:string;name:string;windowId:number|null;projectId:string|null;kind:'task'|'service';outcome:RecentOutcome;startedAt:number;endedAt:number }

/** 「最近结束」的有界记录：任务 / 服务结束后留一条，让用户知道刚才排队的东西是完成了、
 *  被取消了、还是排队超时了。只存脱敏字段（名字、归属、结局、时长）；不存参数、命令、输出。
 *  投影按窗口：本窗口的 + 应用级（windowId null）的。不持久化，重启即空。 */
export function createRecentActivity(now:()=>number,limit=50){
 const items:Recorded[]=[]
 return {
  record(input:Omit<Recorded,'endedAt'>){
   items.unshift({...input,endedAt:now()})
   if(items.length>limit)items.length=limit
  },
  list(windowId:number):RuntimeRecentItem[]{
   const t=now()
   return items.filter(i=>i.windowId===null||i.windowId===windowId).map(i=>({
    id:i.id,name:i.name,kind:i.kind,outcome:i.outcome,projectId:i.projectId,...(i.windowId===null?{scope:'app' as const}:{}),
    ageMs:Math.max(0,t-i.endedAt),durationMs:Math.max(0,i.endedAt-i.startedAt)
   }))
  }
 }
}
export const recentActivity=createRecentActivity(()=>performance.now())

/** 把任务的拒绝原因归成结局。'cancelled' / 'wait timeout' 是调度器原话，其它一律 failed。 */
export function outcomeOfError(e:unknown):RecentOutcome{
 const msg=e instanceof Error?e.message:String(e)
 if(msg==='cancelled')return 'cancelled'
 if(msg==='wait timeout')return 'timeout'
 return 'failed'
}
