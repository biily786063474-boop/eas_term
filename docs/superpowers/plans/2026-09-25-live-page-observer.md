# Live Page Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 页面开发时显示与 AI 工具共享的本地浏览器会话，分屏右侧滑出、画板对话内临时分屏。

**Architecture:** 主进程拥有浏览器和输入控制，托管 MCP 租约或遗留 token 桥鉴权；渲染进程只订阅归属状态与受限截图。一个会话只有一个浏览器，独立窗口只是显隐切换。

**Tech Stack:** Electron BrowserWindow/webContents.sendInputEvent/capturePage、React、CSS、现有 MCP workbench 宿主。

**Spec:** `docs/superpowers/specs/2026-09-25-live-page-observer.md`

## Global Constraints
- 不接管外部 Chrome，不共享其 Cookie；第一版本机 loopback URL。
- 不改 `whenReady()` 的既有注册顺序；新增注册仅追加在相关浏览器功能组。
- 画板与分屏共享一个浏览器，不复制窗口/进程；隐藏时暂停帧捕获。
- 必须从隔离工作树构建并打开应用实际验收。

## Review Focus
- 伪造另一个 leaf 的控制请求必须被拒绝；测试主进程所有权键。
- 非 loopback、`file:`、重定向到远端必须被拒绝；测试导航守卫。
- 隐藏/关闭/主窗口退出不泄漏浏览器进程或截图计时器；测试生命周期。
- 分屏、画板和独立窗口互切必须保持同一 URL/页面状态；实际 UI 验收。
- 小尺寸、亮暗主题和 `prefers-reduced-motion` 不闪现或溢出；截图和动效验收。

### Task 1: 主进程浏览器会话与 MCP 工具
**Files:** `src/main/livePage.ts`、`src/main/livePagePolicy.test.ts`、`src/main/mcpBridge.ts`、`mcp/workbench-tools.json`、`src/main/index.ts`
**Interfaces:** `invokeLivePage(tool,args,ctx)`；渲染层事件 `livePage:state`。
- [x] 先写 URL 与所有权失败测试并确认红灯。
- [x] 实现 loopback URL 限界、会话归属、打开/导航/点击/输入/滚动/结束与捕帧。
- [x] 接现有 MCP 能力租约/传统桥；跑专项测试。

### Task 2: 渲染状态与两种布局
**Files:** `src/preload/index.ts`、`src/renderer/src/features/livePage/*`、`src/renderer/src/features/workspace/PaneView.tsx`、`src/renderer/src/App.tsx`、对应样式。
**Interfaces:** `livePage.onState()`、`livePage.visible()`、`livePage.popout()`；共享 `useLivePages()` 状态。
- [x] 主窗口事件订阅与归属过滤，分屏右抽屉、画板对话内面板；应用验收覆盖开合。
- [x] 440ms 位移+透明度动画、窄宽降级、减少动效、加载/错误反馈；隔离应用专项验证。

### Task 3: AI 引导、应用验收与图纸
**Files:** `src/main/capabilityGuidance.ts`、`docs/architecture/10-模块领地图.md`、`docs/verification/live-page/*`、`scripts/verify-live-page.mjs`
- [x] 以简短条件化说明让页面开发 AI 知道何时调用；非网页任务不调用。
- [x] 构建、全量检查、隔离应用跑同会话的读取/点击/输入/截图、窄节点/减少动效/收起/弹出/返回。
- [x] 更新架构图纸，在独立工作树实现，不碰主工作区其他 agent 改动。

**未验证：** 真实 Claude/Codex/OMP 在线模型主动调用、Windows/Linux 用户机、开发服务器 HMR 与复杂网站、亮色主题逐项视觉验收。它们不计入以上通过项。
