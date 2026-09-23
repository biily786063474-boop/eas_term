/** Trusted host only: never return child diagnostics or configuration to a renderer. */
export interface DeferredLease { environment:string; signal:AbortSignal; close:()=>void }
// Exact approved messages only: never forward arbitrary subprocess diagnostics.
const safeConnectionErrors=new Set([
 'TypeSafe 密钥无效或已失效，请在安全连接设置中更新密钥。',
 'TypeSafe 账户没有此模型权限，请检查服务商账户授权。',
 'TypeSafe 请求过于频繁，请稍后再试；不会自动重复调用。',
 '无法连接 TypeSafe，请检查网络后重试。',
 '请求已取消或超时；服务商可能已处理，请先查看用量再重试。',
 '今日 Jev 调用次数已达上限，UTC 次日恢复；请勿反复重试。'
])
export async function activateDeferredConfiguration(deps:{
 connect:()=>DeferredLease
 request:(method:string,params:unknown)=>Promise<unknown>
 valid:()=>boolean
 stop:()=>void
 stopped:Promise<void>
}):Promise<void>{
 const lease=deps.connect()
 let retained=false
 const revoke=()=>deps.stop()
 try{
  if(!deps.valid()||lease.signal.aborted)throw Error('stale')
  lease.signal.addEventListener('abort',revoke,{once:true})
  await deps.request('host/configure',{configuration:lease.environment})
  if(!deps.valid()||lease.signal.aborted)throw Error('stale')
  retained=true
  void deps.stopped.finally(()=>{lease.signal.removeEventListener('abort',revoke);lease.close()})
 }catch(error){
  deps.stop()
  if(error instanceof Error&&safeConnectionErrors.has(error.message))throw new Error(error.message)
  throw Error('连接验证失败或授权已失效，请检查连接设置后重试')
 }finally{
  lease.environment=''
  if(!retained){lease.signal.removeEventListener('abort',revoke);lease.close()}
 }
}
