# 知识库全库扫描搬进 Worker 并按窗口归属准入 · 隔离验收（2026-09-13 23:20 PDT）

临时知识库 `/tmp/eas-wiki-verify`（a.md 带 front-matter 并链到 [[b]]，b.md，index.md），`wiki.setPath` 指过去。

| 步骤 | 观察 |
|---|---|
| 节能 50%（读数 33/48 GB）`wiki.graph()` | tasks：`wiki-scan:1`「知识库扫描」queued、memory-threshold，窗口归属（projectId null，无 app 标记） |
| 运行中心 | 行"知识库扫描 · 排队中"，范围说明含"知识库图谱与体检的全库扫描"，取消按钮 1 个（`wiki-scan-queued-eco.png`） |
| `runtimeCancelTask` | ok；调用方收到"知识库扫描已取消" |
| 同一实例切普通再请求 | 60 秒后"资源紧张…"——从节能切回后的恢复迟滞（与符号索引那次相同现象） |
| **新实例、一开始就普通模式** | `wiki.graph()` 立即放行，返回 3 个节点；`wiki.lint()` 正常返回；之后 tasks 为空。**Worker 真实链路在应用里跑通** |
| 打包产物 | `out/main/scanWorker-*.js` 独立文件，node 直接以 Worker 加载扫同一目录：ok、3 篇、exit 0 |

顺带：`paths.ts` 的 `walkNotes`/`dirOf`/`isRawDir`/`isMd` 搬到零 electron 的 `walk.ts` 并转出口；Worker 链上的相对导入补 `.ts` 扩展名（node 原生 ESM 需要，打包器也认）。
