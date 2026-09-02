// 引导判据的主进程入口。**判据本身在 `src/shared/ompSetup.ts`**，这里只是再导出。
//
// 搬家的理由（不是洁癖，是这里根本用不了）：文件头原本写着「面板与主进程两侧照同一份说话」，
// 而这件事在 `src/main/` 下**做不到** —— `tsconfig.web.json` 的 include 只有
// `src/renderer/src` 与 `src/shared`，composite 工程要求列全文件，
// 渲染层 import 本文件会直接 TS6307；放宽 include 还有第二道：
// `config.ts` 那条 import 带着 `node:path`，会被打进渲染层 bundle。
//
// **2026-09-02：`OMP_PROVIDERS` / `providerById` / `keyVarOf` 一并删掉了。**
// 那是我们自己维护的四家「带取 key 链接的推荐位」，服务于密钥柜那条路。
// 密钥柜拆掉之后服务商名单直接来自 omp 自己（`omp:listAuthProviders`，69 家）——
// 我们没有理由再维护一份会过期的子集。
export {
  nextStepOf,
  ompLaunchGate,
  ompLoggedInFrom,
  ompModelUsable,
  ompStateFrom,
  authFailureInTail,
  explainOmpFailure,
  humanReasonIn,
  type OmpFailContext,
  type OmpLoginFailure,
  type OmpSmokeResult,
  type OmpStatus,
  type OmpStep,
  type OmpSetupState
} from '../../../shared/ompSetup.ts'
