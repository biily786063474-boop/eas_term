import {runAppTask} from '../runtime/sessionStartup.ts'
import {stageVersion} from './packages.ts'
import type {TaskCost} from '../runtime/resourceLedger.ts'
import type {UpdatableCli} from '../../shared/cliUpdates.ts'

/** 下载 + 解包 + 校验的首版估算：网络 IO 为主，tar 与两次 --version/--help 是短促 CPU；
 *  256MiB 覆盖 tar 解包与校验子进程。不是实测峰值，不是硬上限。 */
export const STAGE_COST:TaskCost={cpu:5,memoryBytes:256*1024**2}

type Runner=<T>(opts:{id:string;name:string;cost:TaskCost;start:(signal:AbortSignal)=>Promise<{result:Promise<T>;completed:Promise<void>}>})=>Promise<T>

/** CLI 更新的下载/校验整段作为**一个应用级托管任务**提交：排队中被取消就根本不发起下载；
 *  外部（更新管理器的 job）取消与任务信号合并；完成只认 stage 自己结束——它是幂等的
 *  （临时目录 + 最后 rename），取消后临时目录由 stage 自己清掉，不需要也不允许自动重试。 */
export function managedStage(root:string,id:UpdatableCli,version:string,signal:AbortSignal,deps:{stage?:typeof stageVersion;run?:Runner}={}):Promise<void>{
 const stage=deps.stage??stageVersion,run=deps.run??runAppTask
 return run<void>({id:'cli-update:'+id,name:'CLI 更新下载与校验（'+id+'）',cost:STAGE_COST,start:async taskSignal=>{
  const combined=AbortSignal.any([signal,taskSignal])
  const done=stage(root,id,version,combined)
  return {result:done,completed:done.then(()=>{},()=>{})}
 }}).catch(e=>{
  // 调度器的 'wait timeout' = 资源紧张排队 60 秒没放行，不是网络问题。更新管理器按
  // /abort|timeout/ 会把它说成「网络恢复后可重试」，所以这里换成资源文案，且不含那两个词。
  if(e instanceof Error&&e.message==='wait timeout')throw Error('资源紧张，更新下载排队等待未获准入；下次定期检查会再试，也可切回普通模式后重试。')
  throw e
 })
}
