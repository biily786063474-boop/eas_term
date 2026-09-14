import {runManagedTask} from './sessionStartup.ts'
import type {TaskCost} from './resourceLedger.ts'

export type WorkerLike = { once(event:'message'|'error'|'exit', listener:(...args:any[])=>void):unknown; terminate():Promise<unknown> }
export type ManagedRun = <T>(opts:{id:string;windowId:number|null;name:string;projectId:string|null;cost:TaskCost;start:(signal:AbortSignal)=>Promise<{result:Promise<T>;completed:Promise<void>}>})=>Promise<T>

const seqs=new Map<string,number>()
/** 「一次性 Worker 经任务准入」的共用编排（符号索引、知识库扫描都用它）：
 *  排队时不建线程；建了线程后 message 回结果给调用方，预算只在线程 exit 才释放；
 *  取消 = terminate（真实退出仍由 exit 落定）。调度器的 'wait timeout' / 'cancelled'
 *  翻译成带 label 的中文。Worker 协议：postMessage({ok:true,...} | {ok:false,error}) 后退出。 */
export function runOneShotWorker<T>(opts:{
 idPrefix:string;label:string;windowId:number|null;projectId:string|null;cost:TaskCost
 createWorker:()=>WorkerLike
 pick:(message:{ok:boolean;error?:string}&Record<string,unknown>)=>T|undefined
 run?:ManagedRun
}):Promise<T>{
 const run:ManagedRun = opts.run ?? runManagedTask
 const n=(seqs.get(opts.idPrefix)??0)+1;seqs.set(opts.idPrefix,n)
 return run<T>({
  id:opts.idPrefix+':'+n,windowId:opts.windowId,name:opts.label,projectId:opts.projectId,cost:opts.cost,
  start:async signal=>{
   if(signal.aborted)throw Error(opts.label+'已取消')
   const worker=opts.createWorker()
   const completed=new Promise<void>(r=>worker.once('exit',()=>r()))
   const result=new Promise<T>((resolve,reject)=>{
    worker.once('message',(m:{ok:boolean;error?:string}&Record<string,unknown>)=>{const v=m.ok?opts.pick(m):undefined;v!==undefined?resolve(v):reject(Error(m.error??(opts.label+'失败')))})
    worker.once('error',e=>reject(e instanceof Error?e:Error(String(e))))
    worker.once('exit',code=>reject(Error(opts.label+'线程已退出（code '+String(code)+'）')))
   })
   void result.catch(()=>{})
   const cancel=()=>{void worker.terminate()}
   signal.addEventListener('abort',cancel,{once:true})
   void completed.then(()=>signal.removeEventListener('abort',cancel))
   return {result,completed}
  }
 }).catch(e=>{
  if(e instanceof Error&&e.message==='wait timeout')throw Error('资源紧张，'+opts.label+'排队等待未获准入；稍后重试，或在运行中心切回普通模式')
  if(e instanceof Error&&e.message==='cancelled')throw Error(opts.label+'已取消')
  throw e
 })
}
