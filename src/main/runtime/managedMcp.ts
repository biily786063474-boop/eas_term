import type {McpClient} from '../mcpClient.ts'
import type {createRuntimeManager,ManagedWork} from './manager.ts'
/** Two promises: caller result may time out, scheduler occupancy must not.
 * Never holds the entire parent agent session. No retry, shell or PID authority.
 */
export function runManagedMcp(manager:ReturnType<typeof createRuntimeManager>,client:McpClient,work:Omit<ManagedWork,'run'>,method:string,params:unknown,timeoutMs=600_000):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  void manager.submit({...work,run:async signal=>{
   if(signal.aborted)throw Error('任务已取消')
   const call=client.requestTracked(method,params,timeoutMs)
   const cancel=()=>call.cancel()
   signal.addEventListener('abort',cancel,{once:true})
   // Attach rejection immediately; timeout informs caller, not resource ledger.
   void call.result.then(resolve,reject)
   try{await call.completed}finally{signal.removeEventListener('abort',cancel)}
  }}).catch(reject)
 })
}
