# 最近项目排序与任务卡自动收尾 · 2026-09-26

用户原始要求：新建项目自动在双击菜单最近列表上层；AI 对话任务由 LLM 完成后自行打钩、自动清除，不要求用户验收。用户已批准实施。

实现工作树 `/private/tmp/eas-first-claude-audit`，分支 `fix/recent-projects-auto-plan-20260926`，基线 f8b42408。根工作区原有脏改动未混入；根目录仅同步本任务新证据/本文件。

已完成：MRU 排序与新增 touchProject；PlanCard/宿主 IPC/插件 store/面板/三 CLI 共用指引统一 reported_done 自动完成，空闲+CAS+session/owner 停止门闩保护，历史 accepted 不伪造。架构03/10/11/13同步。独立审查停止竞态已修，两个交错回归 RED→GREEN。

最终 check：3806 pass / 19 skip / 0 fail（3825 total）。隔离真实 Electron 专项六项通过，截图亲眼验证，测试夹具已还原并生产重建成功。没有真实模型请求；忙碌转空闲及并发停止由生产代码集成测试覆盖。详细边界与失败记录见 docs/verification/recent-auto-plan/README.md。

关键新增：projectMenuOrder.ts 与测试、projectsMru.test.ts、autoPlanCompletion.test.ts、scripts/verify-details-ui.mjs。完整修改以工作树 git diff 为准。

状态：尚未提交/推送/合并/发版；待用户要求提交时默认推送对应分支，要求合并时先审查最新 main，不从根目录脏分支发布。本轮不再重复上一批低内存/资源队列（已合并到基线）。

## 提交授权与复验
2026-09-26 用户要求提交并安全合并，已开始执行；上述未提交状态为授权前快照。主线仍 f8b42408，独立审查无阻断，MCP 版本 Minor 已同步并补真实 server 初始化回归。六项 UI 与全量检查再次通过。后续核对 origin/main 是否包含 fix(recent-projects-auto-plan) 提交以判定合并结果；本轮不发版。
