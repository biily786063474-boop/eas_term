# data-safety 调研过程

## 目标
扫 src/main/ 下所有会覆盖/删除用户数据的路径，找出「触发条件 / 有无备份或确认 / 能否恢复」，排序输出。

## 日志
- [1] 列出 src/main 结构；grep 删除类调用（rm/rmSync/unlink/rmdir）与写入类调用（writeFileSync/rename/copyFile）。
  产出候选清单：canvas.ts, agentHistory.ts, projects.ts, todos.ts, board.ts, gantt.ts, secrets.ts,
  wiki/*, teamWorktreeOps.ts, snapshot.ts, roles.ts, dict.ts, agentRules.ts, skillLibrary/write.ts, mcpBridge.ts, fs.ts
- 下一步：先读 canvas.ts（事故已修的基线），再逐个对照。
- [2] 读完 canvas.ts + shared/canvasBackup.ts + agentHistory.ts + AgentChatView.tsx（历史存取）
      → H1 (adoptOrphan 先删后存)、H2 (prune 200)、H3 (备份判据维度不足)
- [3] 读完 projects.ts / secrets.ts / wiki/index.ts / wiki/schema.ts / wiki/git.ts
      → H4 (rollback 不检查快照结果)、H5 (读失败→空→覆盖 通用模式)
- 下一步：teamWorktreeOps.ts、fs.ts(move/trash)、roles/dict/skillLibrary/mcpBridge、team.json 并发
- [4] 读完 teamWorktreeOps.ts / fs.ts / mcpBridge.ts / agentRules.ts + .gitignore
      → H6 (git status 失败降级为 0)、M1 (写回无冲突检测)、M2 (.eas-backup 固定名)、
        M3 (rmSync eas-wiki 目录)、M4 (分发产物覆盖用户改动)
      修正：syncRules 只由 rules:sync 手动触发，不是每次启动（启动是 refreshInstalledRules）
- 下一步：team.json 并发、roles/dict/skillLibrary、todos/board/gantt 的删除确认、snapshot/pasteImages
- [5] 读完 todos/board/dict/team.json 并发/snapshot/pasteImages/skillLibrary
      → M5-M8 + 「查过但风险低」清单。修正：pasteImage 不进画布，风险降级。
- 下一步：roles/gantt/prefs、渲染层删除确认层、最后排序收尾
- [6] 查删除入口的确认层 → H0：removeProject 三个入口零确认，且 pruneOrphanNodes 后
      frames.length 不变 → 新补的备份判据挡不住。这是最强发现。
- 下一步：写总结表 + 「需要谁来补」，收尾
- [7] 收尾：加总表 / 一句话结论 / 推翻的前提 / 需要谁来补 / 我没做什么。
      核对行号，修正 useSwipeRemove THRESHOLD 12→11。
- 完成。findings.md 315 行，H0-H6 + M1-M8 + 低风险清单。
- 卡住过的地方：无。grep 的 --include 在 zsh 下要加引号（第一次报 no matches found）。
