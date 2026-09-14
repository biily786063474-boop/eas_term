# 符号索引搬进 Worker 并按窗口归属准入 · 验收（2026-09-13 22:55 PDT）

| 步骤 | 观察 |
|---|---|
| 节能 50%（隔离读数约 72%）下 `codeGraph.symbols('/tmp/eas-sym-verify')` | tasks：`symbols:1`「符号索引」queued、memory-threshold，**窗口归属**（无 app 标记） |
| 运行中心 | 行"符号索引 · 排队中"，范围说明含"代码地图的符号索引"，取消按钮 1 个（`symbols-queued-eco.png`） |
| `runtimeCancelTask('symbols:1')` | 返回 ok；调用方收到取消（文案第一版是英文 `cancelled`，已改为"符号索引已取消"并先红后绿） |
| 切普通 80% 重跑 | **仍排队 60 秒后超时**，返回资源紧张文案。原因：本机此时内存约 72%，高于普通模式 70% 的恢复线（策略迟滞，非本改动问题）；此前插件验收放行时内存约 65% |
| 打包产物 | `out/main/tsSymbolsWorker-*.js` 独立文件；用 node 直接以 Worker 方式加载它跑同一临时项目：message ok、files 含 a.ts、exit 0。`typescript` 是 devDependency，随 `tsAst` chunk 打包，不依赖正式包里的 node_modules |

未验：在真实应用里被准入后的完整链（起线程→回图→exit 释放）没有在隔离实例里观察到，因为本机内存没有低于恢复线；该链由 `managedSymbols.test.ts`（假 Worker）与 `tsSymbolsWorker.test.ts`（真 Worker、真 TS 项目）覆盖。
