import type {NoteInfo} from './scan'
import {runOneShotWorker,type WorkerLike,type ManagedRun} from '../runtime/oneShotWorker.ts'

/** 全库扫描的首版预留：IO 为主、正则轻量。估算，不是实测。 */
export const SCAN_COST = {cpu: 5, memoryBytes: 128 * 1024 ** 2}

/** 知识库图谱/体检共用的全库扫描：Worker 里跑，按窗口归属准入；知识库不是项目，projectId 为 null。 */
export function scanNotesManaged(opts:{root:string;windowId:number;createWorker:(workerData:{root:string})=>WorkerLike;run?:ManagedRun}):Promise<NoteInfo[]>{
 return runOneShotWorker<NoteInfo[]>({
  idPrefix:'wiki-scan',label:'知识库扫描',windowId:opts.windowId,projectId:null,cost:SCAN_COST,
  createWorker:()=>opts.createWorker({root:opts.root}),
  pick:m=>Array.isArray(m.notes)?m.notes as NoteInfo[]:undefined,
  run:opts.run
 })
}
