// 引导判据的主进程入口。**判据本身已经搬到 `src/shared/ompSetup.ts`**，这里只是再导出。
//
// 搬家的理由（不是洁癖，是这里根本用不了）：文件头原本写着「面板与主进程两侧照同一份说话」，
// 而这件事在 `src/main/` 下**做不到** —— `tsconfig.web.json` 的 include 只有
// `src/renderer/src` 与 `src/shared`，composite 工程要求列全文件，
// 渲染层 import 本文件会直接 TS6307；放宽 include 还有第二道：
// 下面 `config.ts` 那条 import 带着 `node:path`，会被打进渲染层 bundle。
//
// **`keyVarOf` 留在这边不跟过去**：它要 `config.ts` 的 `ompKeyEnvName`（那份文件带
// `node:path`），而渲染层也不需要它 —— 变量名走 `omp:keyVar` 这条 IPC 拿。
import { ompKeyEnvName } from './config.ts'
import { type OmpProvider } from '../../../shared/ompSetup.ts'

export {
  OMP_PROVIDERS,
  providerById,
  nextStepOf,
  authFailureInTail,
  type OmpProvider,
  type OmpStep,
  type OmpSetupState
} from '../../../shared/ompSetup.ts'

/** 这家服务商的 key 存在密钥柜里的哪个变量名下。 */
export function keyVarOf(p: OmpProvider): string {
  return ompKeyEnvName(p.id)
}
