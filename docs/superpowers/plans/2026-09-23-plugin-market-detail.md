# 插件市场详情视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在插件市场中点击卡片非交互区域打开可阅读的完整详情，安装前明确场景、步骤、能力、工具和权限。

**Architecture:** v2 目录可携带受限结构化 `detail`；新客户端校验后展示，旧目录与老客户端不受影响。市场卡片展示区成为语义点击面，详情在同一市场弹窗内替换列表，安装/配置链路保持现状。

**Tech Stack:** Electron + React + TypeScript + Node test + CDP 隔离应用验收。

**Spec:** `docs/superpowers/specs/2026-09-23-plugin-market-detail.md`

## Global Constraints

- 不新增可见“查看详情”按钮；卡片非交互区域可点，现有动作不得误触详情。
- 未安装阅读详情不得下载 zip、启动插件或请求凭证。
- 只渲染纯文本与受控组件；不接受目录提供的 HTML/脚本。
- 当前生产 v2 目录 8 项，线上目录发布为单独任务，不使用默认候选集覆盖生产。
- 不涉及自动更新、评分、评论、支付。

## Review Focus

- 外部来源恶意长文本/HTML：必须限制长度、纯文本呈现。
- 未安装、离线缓存和无 `detail`：仍可打开，不编造内容。
- 点击安装、更新、配置：只做原动作，不进入详情。
- 搜索/分类/滚动与焦点：返回后恢复。
- 来源、权限和版本变化：详情不能代替原授权确认。

## Task 1 — 详情数据契约

- [x] 在 `src/shared/pluginDetail.ts` 定义有限字段、校验和纯文本规范；先写 `pluginDetail.test.ts` RED，再实现 GREEN。
- [x] 扩展 `src/main/pluginRegistry.ts`、`src/shared/types.ts`，使 v2 可带可选详情；v1 不使用它。测试未知字段、长度、恶意 HTML 字符串和无详情降级。
- [x] 更新 `scripts/plugin-registry-build.mjs` 的可选详情读入/校验；目录包版本与哈希绑定。构建测试先 RED 后 GREEN。

## Task 2 — 市场详情导航和界面

- [x] 在 `PluginMarketModal.tsx` 内实现详情视图（避免额外组件边界）：首屏、场景、步骤、能力/工具、权限/数据、版本/支持；缺失显示“开发者未提供”。先以 `pluginCardLayout.test.mjs` 和隔离应用脚本约束交互。
- [x] 修改 `PluginMarketModal.tsx`：卡片展示区整体为语义点击面；原操作控件为兄弟；进入详情与返回、Esc 两级处理、焦点/滚动恢复。删去旧 `<details>` 简介浮层。
- [x] `canvas.css` 增加亮暗兼容、窄屏单列、hover/focus 与正文层级；不改市场全局品牌 token。

## Task 3 — 8 个现有插件内容

- [x] 对照当前线上版本的包/README/工具定义建立 `resources/plugin-market-details/` 8 份受限 JSON；不确定的工具填“未提供”。
- [x] 加构建验收：8 项名称/版本绑定、工具名真实性、结构化内容合法；旧 v2 目录无详情仍可读。
- [x] 更新 `docs/architecture/10-模块领地图.md` 与发布说明，明确不会自动上架新目录。

## Task 4 — 真机验收与收尾

- [x] 构建、类型检查、全量检查；失败原样报告。
- [x] 隔离 Electron/CDP 在真实市场走卡片点击、内嵌动作、防误触、返回、键盘、窄宽、暗亮、未安装无下载；截图放 `docs/verification/plugin-market-detail/`。
- [x] 整分支 review、`git diff --check`、仅提交本次文件；未经额外发布确认不改生产目录或桌面正式版。
