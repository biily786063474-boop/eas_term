# cross-checker · 过程记录

批次目标：验证确认清单 —— 这一批点「算了」，确认取消路径不起任何进程。
我的角色：cross-checker（占位，与另一角色并列，用于检验清单能否列出多行）。

## 时间线

1. `find .plans` → **目录整个不存在**。说明这是本项目第一次落 team 产出，
   没有前一批的残留可比对。
2. `git log` → 定位到 `fa22f60 feat(team): team_spawn 派活 —— 总闸 → 校验 → 确认清单 → 逐个起`，
   这一批要验的就是它。
3. 通读四份源码：
   - `src/renderer/src/features/team/batchSpec.ts`（批次校验，纯函数）
   - `src/renderer/src/features/team/batchRequest.ts`（排队 / 限流 / 决定回送）
   - `src/renderer/src/features/team/TeamBatchModal.tsx`（清单 UI，两个按钮）
   - `src/renderer/src/mcpHandler.ts:574-650`（`team_spawn` 五段式）
4. `grep -rn finishBatch|resolveBatchRequest|askForBatch src/` → 追全部调用点。
   **这一步查出了下面 F-2。**
5. `node --test 'src/renderer/src/features/team/*.test.ts'` → 见 findings 的「测试基线」。

## 我做不到的事（先说清楚）

我跑在被起出来的 agent 会话里，**看不到用户按了哪个按钮**。
`decision.go` 是渲染进程里的一个布尔值，不会传到我的上下文。
所以「点了算了但仍然起了进程」和「其实点的是开工」这两种情况，
从我这一侧是**无法区分**的 —— 结论必须由能看到弹窗的一方（用户 / team-lead）合并判断。
findings.md 里我只写我能证的那部分。
