# silent-fail 进度

## 目标
找最近两天新写的代码里「返回成功但其实没生效」的静默失败。
判据：catch 了异常没留痕 / 返回 ok:true 但语义没完成 / 判定依赖一个可能不成立的前提。

## 做了什么
1. `git log --oneline -25` + `--since=3days --name-only` → 范围锁定 2026-08-19~08-20：
   team 系列（E-07 worktree / E-10 花费 / E-11·E-12 花名册 / E-13 交活自检）、
   agentHistory、canvasBackup、rules。
2. 通读（小文件全读）：`src/shared/team{Cost,Findings,Roster,Worktree}.ts`、
   `src/main/teamWorktreeOps.ts`、`src/main/agentHistory.ts`、`src/main/canvas.ts`、
   `src/shared/canvasBackup.ts`、`src/renderer/src/features/team/brief.ts`。
3. `mcpHandler.ts`（1385 行）先 grep 定位再定点读：
   `resolveFrame` / `safePath` / team_status / team_send / team_dissolve / team_spawn。
4. 顺着可疑链路追到主进程：`mcpBridge.ts` 的 `mcpEnv`、`session.ts` 的
   `agentChat:stop` 与 spawn 处的 cwd/env、`preload/index.ts` 的 stop。
5. 为定性 S-11/S-12/S-13 读了 `AgentChatView.tsx` 的历史加载 / 保存 / 孤儿列表三段。
6. 期间写了两版 findings.md（第一版 9 条，第二版重排 + 补证据链 + 补「已排除」）。

## 结果
findings.md 共 14 条（S-01 ~ S-14）+「已排除」3 条 +「我没做什么」+「谁来补」。
最重的是 S-01：`42d4b80`（worktree）把 `ae03989`（信 ctx.project）的前提打掉了，
隔离 agent 的 EAS_PROJECT 是工作树路径 → resolveFrame 静默回落到用户当时看着的 Frame。

## 推翻的假设（不要替人抹平，所以显式记着）
- 原以为「worktree agent 的 findings 落在工作树里、teamFindings 查主工作区 → E-13 失效」
  → **不成立**，brief.ts:41-50,64-66 已经给了绝对路径，08-19 就修过。已写进 findings 的「已排除」。
- 原以为 S-12（空 turns 删文件）是活的 bug → 查到调用方 `AgentChatView.tsx:228-229`
  有 `if (!turns?.length) return`，**拦得住**，降级为「防御缺失」。
  但顺着这段代码发现了新的 S-13（注释写「节流」实现是「防抖」）。

## 没卡住
没有出现同一个错误重复两次的情况，没有 BLOCKED 段。
唯一定不了性的是 S-14（Windows 路径分隔符），需要真机或 path.sep 层面的核对 ——
已在 findings.md 的「谁来补」里点名。

## 边界（写给收活的人）
一行代码都没跑、没构造任何失败场景、没改任何文件（除本目录两份产出）。
全部结论来自读代码 + git 历史；标「实测」的都是引用别人 commit message 里的记录。
mcpHandler.ts 剩约 900 行、session.ts 2000+ 行、TeamPanel.tsx / batchSpec.ts 均未读。
