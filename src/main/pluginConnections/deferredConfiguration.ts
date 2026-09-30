import { tm } from '../../shared/i18n/current.ts'
import type { I18nKey } from '../../shared/i18n/index.ts'
/** Trusted host only: never return child diagnostics or configuration to a renderer. */
export interface DeferredLease { environment:string; signal:AbortSignal; close:()=>void }
// Exact approved messages only: never forward arbitrary subprocess diagnostics.
// The child reports these exact Chinese texts; we map them to localized ones for display.
const safeConnectionErrors=new Map<string,string>([
 ['TypeSafe 密钥无效或已失效，请在安全连接设置中更新密钥。','errPlugin.conn.tsKey'], // i18n-allow: 子进程原文的逐字匹配键，显示时换成词典文案
 ['TypeSafe 账户没有此模型权限，请检查服务商账户授权。','errPlugin.conn.tsPerm'], // i18n-allow: 子进程原文的逐字匹配键，显示时换成词典文案
 ['TypeSafe 请求过于频繁，请稍后再试；不会自动重复调用。','errPlugin.conn.tsRate'], // i18n-allow: 子进程原文的逐字匹配键，显示时换成词典文案
 ['无法连接 TypeSafe，请检查网络后重试。','errPlugin.conn.tsNet'], // i18n-allow: 子进程原文的逐字匹配键，显示时换成词典文案
 ['请求已取消或超时；服务商可能已处理，请先查看用量再重试。','errPlugin.conn.tsAbort'], // i18n-allow: 子进程原文的逐字匹配键，显示时换成词典文案
 ['今日 Jev 调用次数已达上限，UTC 次日恢复；请勿反复重试。','errPlugin.conn.tsQuota'] // i18n-allow: 子进程原文的逐字匹配键，显示时换成词典文案
])
export async function activateDeferredConfiguration(deps:{
 mode?:'restore'
 verified?:(environment:string)=>void
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
  await deps.request(deps.mode==='restore'?'host/restore':'host/configure',{configuration:lease.environment})
  if(!deps.valid()||lease.signal.aborted)throw Error('stale')
  if(deps.mode!=='restore')deps.verified?.(lease.environment)
  retained=true
  void deps.stopped.finally(()=>{lease.signal.removeEventListener('abort',revoke);lease.close()})
 }catch(error){
  deps.stop()
  if(error instanceof Error&&safeConnectionErrors.has(error.message))throw new Error(tm(safeConnectionErrors.get(error.message) as I18nKey))
  throw Error(tm('errPlugin.conn.e55'))
 }finally{
  lease.environment=''
  if(!retained){lease.signal.removeEventListener('abort',revoke);lease.close()}
 }
}
