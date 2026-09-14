import type {TaskCost} from './runtime/resourceLedger.ts'
import type {SymbolGraphResult} from '../shared/symbolGraph.ts'
import {runOneShotWorker,type WorkerLike,type ManagedRun} from './runtime/oneShotWorker.ts'

/** 符号索引经窗口归属的任务准入（编排在 runtime/oneShotWorker.ts，与知识库扫描共用）。 */
export function analyzeSymbolsManaged(opts:{
 root:string;windowId:number;projectId:string|null;cost:TaskCost
 createWorker:(workerData:{root:string})=>WorkerLike
 run?:ManagedRun
}):Promise<SymbolGraphResult>{
 return runOneShotWorker<SymbolGraphResult>({
  idPrefix:'symbols',label:'符号索引',windowId:opts.windowId,projectId:opts.projectId,cost:opts.cost,
  createWorker:()=>opts.createWorker({root:opts.root}),
  pick:m=>m.graph as SymbolGraphResult|undefined,
  run:opts.run
 })
}
