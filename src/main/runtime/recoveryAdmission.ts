/** Restore candidates are never task-capable. Unknown IPC defaults to deny.
 * Normal windows keep their existing permissions; this only adds restrictions. */
const reads=new Set([
 'idleRecovery:status','prefs:get','projects:list','roles:list','board:list','canvas:load','fs:readDir','fs:readImageFile',
 'agentChat:listClis','agentChat:hookStatus','agentChat:modelCatalog','agentChat:resumeOwner','agentChat:planCardRead',
 'agentHistory:load','agentHistory:list','agentChat:listSessions','cliAuth:check','cliAuth:installSnapshot',
 'runtime:monitor','runtime:waiting','livePage:state','phone:status','usage:query','quota:snapshot',
 'quota:get','quota:read','update:check','update:current','update:latest','cliUpdates:get','omp:status',
 'omp:listModels','omp:loginInFlight','omp:usage','plugins:list','plugin:list','skill:status',
 'secrets:status','shortcuts:get','gantt:list','footprint:list','browser:favorites','browser:routes',
 'capabilities:status','app:gpuInfo','dict:userTerms','rules:list'
])
const controls=new Set(['idleRecovery:seal','idleRecovery:bootstrap','idleRecovery:reply','idleRecovery:ready','idleRecovery:test'])
const passive=new Set([...reads,'island:state','island:update','diag:event','canvas:save','canvas:save-sync','agentHistory:save'])
export function createRecoveryAdmission(){
 const candidates=new Set<number>(),retired=new Set<number>(),pending=new Map<number,number>()
 let generation=0
 return {
  candidate(id:number){candidates.add(id)},
  isCandidate:(id:number)=>candidates.has(id),
  retire(id:number){candidates.delete(id);retired.add(id)},
  promote(id:number){candidates.delete(id)},
  generation:()=>generation,
  activity(){generation++},
  pending:()=>[...pending].filter(([id])=>!candidates.has(id)&&!retired.has(id)).reduce((sum,[,n])=>sum+n,0),
  enter(id:number,channel:string):()=>void{
   if(retired.has(id))throw Error('恢复前的窗口已关闭，请在当前窗口重试')
   if(candidates.has(id)&&!reads.has(channel)&&!controls.has(channel))throw Error('恢复中的窗口暂不能启动操作: '+channel)
   if(controls.has(channel))return()=>{}
   if(!candidates.has(id)&&!passive.has(channel))generation++
   pending.set(id,(pending.get(id)??0)+1)
   let done=false
   return()=>{if(done)return;done=true;const n=(pending.get(id)??1)-1;if(n)pending.set(id,n);else pending.delete(id)}
  }
 }
}
export const recoveryAdmission=createRecoveryAdmission()
