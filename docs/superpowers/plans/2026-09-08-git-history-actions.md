# Git 历史交互实施计划

**Goal:** 落地用户批准的 `docs/prototype/2026-09-08-git-history.html`，不在用户仓库执行检出测试。
**Architecture:** 独立主进程 Git history service，Git CLI 参数数组；IPC 写操作先 guardDir 工作树和 Git 元数据目录；渲染复用 HistoryView、CanvasContextMenu、DiffView。
**Tech Stack:** Electron / TypeScript / React / system Git，无新依赖。

## 边界
- 不扩展 Cherry-pick/Revert/Reset 等破坏性操作；原有 Reset 确认保留。
- 检出/返回分支必须阻止脏工作区，不自动 stash、force、丢弃或发送消息。
- 演示原型和源码修复与 0.4.87 冻结发布包分离。
- 仅操作本轮文件，保留根目录其它未提交工作。

## 执行顺序（本会话串行）
- [x] 主进程 `gitHistory.ts` 与真实临时仓库测试：校验提交、分支/标签名；实现 checkout/create branch/tag；记录可返回分支；比较两个提交的文件列表/numstat，保留 NUL 分隔路径与重命名；二进制计数为空。
- [x] `git.ts` 注册新 IPC，`preload/index.ts` 同步方法；所有新写入口 guardDir 检查工作树及 common git dir，失败返回明确 error。
- [x] `HistoryView.tsx` 增加右键菜单、检出/分支/标签确认、返回原分支、选择比较与错误反馈；`DiffView.tsx` 支持双提交及旧路径。文件按 A/D/M/R 配色并显示计数。
- [x] `node --test src/main/gitHistory.test.ts` 红→绿；类型检查、构建、真实隔离 Electron 打开版本管理与临时 Git 仓库截图检查；补架构图纸与验收记录。不得把未验证的 Windows UI 写成已验证。
