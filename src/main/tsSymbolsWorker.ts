// 符号索引的 Worker 入口。**零 electron**，node 直接跑（tsSymbolsWorker.test.ts）。
// 主进程原来同步 ts.createProgram，大项目整个界面冻几秒；搬到这里之后主线程只等消息，
// 取消 = terminate，预算随线程 exit 释放（managedSymbols.ts）。
// 只回一条消息然后退出：这条线程是一次性的，不缓存 Program（缓存归 tsProvider 那侧）。
import {parentPort, workerData} from 'node:worker_threads'
import {analyzeSymbols} from './tsSymbols.ts'

const root = typeof workerData?.root === 'string' ? workerData.root : ''
try {
  parentPort?.postMessage({ok: true, graph: analyzeSymbols(root)})
} catch (e) {
  parentPort?.postMessage({ok: false, error: e instanceof Error ? e.message : String(e)})
}
