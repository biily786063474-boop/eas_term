# 更多与项目用量仪表盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在更多抽屉提供可追溯、不虚构的跨项目用量统计，并保留 Skill/知识库。

**Architecture:** CLI 翻译层增加真实计量标记，session 仅旁路转交生命周期；独立主进程账本负责去重、时间归属和持久化。固定 IPC 返回汇总与分页明细，React/SVG 绘制真实时间轴，不依赖聊天日志。

**Tech Stack:** Electron / TypeScript / React / Node fs / 原生 SVG，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-10-usage-drawer.md`

## Global Constraints
- 不改变 whenReady 原注册顺序、沙箱或路径保护；用户指定路径写出必须经过 guardPath。
- 不改现有会话 tally 口径，不依赖主工作区尚未提交的统计补丁。
- 独立账本最多 90 天 / 50,000 轮；故障不阻断对话；无历史正文扫描。
- 在现有干净隔离工作区 `.worktrees/voice-regression` 的 `feature/usage-drawer` 实施，不覆盖主工作区无关修改。
- 真实构建、隔离实例验证后才能宣称完成；此轮不自动发版。

## 实际领域与风险
- `CanvasWikiDrawer.tsx` owns tabs/open/outside-click，`CanvasSkillPanel` 必须复用。`canvas.css` 250px 与工具栏位移需同步。
- `agentChat/session.ts:handleEvent` 是一轮交付/结束汇合点；`wireProc` 有进程代次防旧回调，旁路不能破坏。
- `claudeEvents.ts` result 缺失值目前补零且 total_cost_usd 累计；`codexEvents.ts` input 含缓存；`ompEvents.ts:turnDoneOf` 还用于错误收尾。
- `agentHistory.ts` 是裁剪后的显示历史，不是账本。`projectRootOf` 处理角色 worktree；注册项目用最长路径边界匹配。
- 契约 `shared/agentChat.ts`、preload、主进程注册、架构 03/10 要同步。

### Task 1: 真实计量与账本核心
- [x] 写失败测试：三 CLI 缺失/缓存、累计费用差、去重、跨日范围、未知不能为零。
- [x] shared usage 协议和纯聚合/生命周期模块；CLI 仅补 metadata，不改变原消费者行为。
- [x] 运行定向测试，确认通过。

### Task 2: 安全持久化与生命周期接线
- [x] 测试重启、异常文件、90天/数量上限、分页和手动标记验证。
- [x] 固定 userData 文件原子保存；失败状态可见；主进程启动/结束旁路记账、进程计数域重置。
- [x] 只读 query + 阶段标记 + guarded CSV 导出 IPC/preload；不接收任意账本路径。
- [x] 运行 typecheck 与主进程回归。

### Task 3: 纵向更多界面
- [x] 将边缘/标题改更多，三 tab，保留已有 Skill/wiki 组件和 outside-click。
- [x] 实现期间/项目筛选、时间折线、维度汇总、分页轮次与阶段标记、CSV 导出、错误/空态/覆盖范围提示。
- [x] 响应式 426px 抽屉、匹配工具栏让位、折线键盘/hover 明细。

### Task 4: 验收与文档
- [x] npm run typecheck / npm test / npm run build，原样记录失败。
- [x] 隔离实例验证三个 tab、空态、测试账本趋势/筛选/标记/导出，截图亲眼检查；测试数据不能写正式 profile。
- [x] 更新架构 03/10、计划完成状态和验证记录，明确未验证项；交付开发实例而非自动发版。

## 执行结果

已实现并完成隔离回归，详见 `docs/verification/usage-drawer/README.md`。默认并发有历史时序测试抖动，已原样记录；限制并发4的全量套件通过。原生保存对话框用测试桩，Windows/真实付费CLI未实测。当前保留开发分支，未合并、未发版。
