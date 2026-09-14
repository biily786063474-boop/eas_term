// 知识库全库扫描的 Worker 入口。**零 electron**（scan.ts → walk.ts 都不引 electron）。
// 一次性：扫完回一条消息就退出；取消 = terminate。
import {parentPort, workerData} from 'node:worker_threads'
import {scanNotes} from './scan.ts'

const root = typeof workerData?.root === 'string' ? workerData.root : ''
try {
  parentPort?.postMessage({ok: true, notes: scanNotes(root)})
} catch (e) {
  parentPort?.postMessage({ok: false, error: e instanceof Error ? e.message : String(e)})
}
