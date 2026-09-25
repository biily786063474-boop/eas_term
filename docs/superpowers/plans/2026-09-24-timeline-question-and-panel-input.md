# 时间轴原始问题与插件鼠标边界 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 成果记录显示用户发起任务的原话；插件未选中不拦画布鼠标，选中也不拦画布缩放。

**Architecture:** 时间轴字段沿现有 host event → candidate → record → detail 链路传递；插件面板仅调整 iframe 的选中态命中，不改插件 IPC/权限；画布现有 wheel 路由保持权威。

**Spec:** `docs/superpowers/specs/2026-09-24-timeline-original-question.md`，另含用户 2026-09-24 确认的插件鼠标规则。

## Task 1: 时间轴存储与工具契约
- [x] 先为 `store.mjs`、`server.mjs` 写失败测试：原话新增、更新省略时保留、旧库兼容、无效长度拒绝。
- [x] 跑红；最小实现可选 `originalQuestion` 和工具 schema/指令；跑绿。

## Task 2: 全局候选来源
- [x] 为 `pluginEvents.ts`、`capture.mjs`、`candidates.mjs` 写失败测试：真正用户问题、续接沿用、失败/取消不落库、确认后传字段。
- [x] 跑红；最小实现有界且白名单的原话传递；跑绿。

## Task 3: 时间轴 UI
- [x] 给详情/候选写有无字段与 HTML 安全断言；跑红。
- [x] 详情在摘要前显示原问题；候选也显示；旧记录显示未记录；跑绿。

## Task 4: 插件鼠标边界
- [x] 查清 iframe 与 CanvasStage、wheelPassthrough 的共生；写未选中/选中/缩放的失败测试。
- [x] 只对画布插件面板切换 iframe 命中：未选中不吃画布鼠标，选中普通交互可用；缩放仍由宿主画布接管；最大化不变。
- [x] 隔离实例实测点击、空格拖拽平移、滚动、Ctrl+滚轮缩放、CDP 捏合，不改变 popup 或其他节点；iframe 焦点内修饰键桥也验收。

## Task 5: 全面验证与图纸
- [x] 更新 `docs/architecture/10-模块领地图.md` 和相关插件事件图纸。
- [x] 全量 `npm run check`、`npm run build`、隔离实例打开，对照真实位置截图/DOM 验收。
- [x] 不读写正式时间轴数据；不在主脏工作区操作；用户未要求发版。
