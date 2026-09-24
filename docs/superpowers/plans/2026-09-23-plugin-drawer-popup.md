# Plugin Drawer Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在右侧插件抽屉直接打开已装插件面板，且 Jev 等缺少必填 API Key 时先安全配置。

**Architecture:** 复用现有 PluginPanel 的面板会话/沙箱通信；只把画布节点专属的尺寸和命名动作改成可选适配器。抽屉管理卡片 → 配置守卫 → popup 状态机；主进程记录 popup surface 并拒绝 popup 的 canvas.call。

**Tech Stack:** React + TypeScript + Electron IPC + Node test + 隔离 Electron/CDP。

**Spec:** `docs/superpowers/specs/2026-09-23-plugin-drawer-popup-design.md`

## Global Constraints

- 不新造可信 iframe、插件代理或密钥存储；继续使用 `eas-plugin://`、`sandbox="allow-scripts"`、现有配置 API。
- 只允许已安装、已开启、有 `panels` 的 `cli:'eas'` 卡片打开面板；开关/卸载不冒泡误触。
- 缺必填 secret 时先配置；保存不等于连接；Jev 付费验证仍须原面板显式确认。
- popup 无画布节点，主进程必须拒绝其 `eas/canvas.call`；panelClose 在关闭、卸载、切换及迟到打开时均执行。
- 不触碰其他 agent 修改、正式应用及生产目录；UI 完成定义包括构建并打开隔离应用亲眼验收。

## Review Focus

1. 打开面板的 Promise 晚于 popup 关闭：立即 panelClose，不能留下插件进程引用。
2. 配置 status 失败或密钥柜锁定：不得推断已配置；能进入安全配置页，不启动面板。
3. 多面板切换：旧 session 先关闭；只允许清单中的 panelId。
4. 开关、卸载、安装确认的 click/Esc：不得误开 popup 或关闭错误的层。
5. popup iframe 发起 canvas.call：即使插件清单授予 canvas 权限也必须被主进程拒绝。

## Task 1 — 资格与必填配置守卫

**Files:**
- Create `src/renderer/src/features/canvas/pluginDrawerGate.ts`
- Create `src/renderer/src/features/canvas/pluginDrawerGate.test.ts`
- Modify `src/renderer/src/features/canvas/CanvasMarketPanel.tsx`

**Interfaces:**
- `panelEligible(p: PluginInfo): boolean` 只识别已启用 Eas 面板。
- `missingRequiredSecrets(p: PluginInfo, configured: readonly string[]): string[]` 只看 `config.fields` 中 `required && type==='secret'`。
- 抽屉安装成功后 `await reload()` 得到安装后的 PluginInfo，再查 `window.api.plugins.configuration('status',p.id)`；结果 `ok:false` 走设置/错误路径，不猜测。

- [ ] 写门禁测试：Eas 启用/关闭、多面板、Claude、仅可选字段、缺/已有密钥；运行 `node --test src/renderer/src/features/canvas/pluginDrawerGate.test.ts` 看到 RED。
- [ ] 实现两个纯函数并运行同命令得到 GREEN；`npm run typecheck`。
- [ ] 在抽屉安装提交后用返回的已装记录检查必填字段；失败/缺失打开现有设置流程，普通插件保持现状。先补 UI 静态/隔离测试 RED 再改 JSX。
- [ ] 跑目标测试与类型检查；提交此任务。

## Task 2 — popup surface 复用宿主面板并加主进程硬闸

**Files:**
- Modify `src/renderer/src/features/plugins/PluginPanel.tsx`
- Modify `src/renderer/src/features/plugins/appsProtocol.ts`
- Modify `src/main/pluginHost.ts`
- Modify `src/preload/index.ts`（仅参数类型需显式 surface 时）
- Modify `src/shared/pluginProtocol.ts`（仅共享 surface 类型需要时）
- Test `src/renderer/src/features/plugins/appsProtocol.test.ts`, `src/main/pluginHost*.test.ts`

**Interfaces:**
- `PanelCtx` 加可选 `surface?: 'canvas'|'popup'`，旧调用默认 canvas；popup 使用 `nodeId:'',frameId:'',projectId,cwd,surface:'popup'`，不虚构真实节点。
- `PluginPanel` 的协议/iframe 生命周期抽成同文件共享视图，画布适配器才调用 `resizeNode/renameNode`；popup 的尺寸请求只更新弹窗布局上限。
- 主进程 `panelOpen` 对 popup 返回 `canvasAllow:[]`；`panelRpc('eas/canvas.call')` 遇 popup 立即返回 `JSONRPC_METHOD_NOT_FOUND`。

- [ ] 先写 surface 判定测试：canvas 兼容、popup 初始化不声明 canvas 权限、popup canvas.call 被拒；运行目标测试确认 RED。
- [ ] 实现主进程硬闸和协议响应；运行目标测试 GREEN。
- [ ] 在 `PluginPanel` 里分离 canvas 专属动作，保留 `panelOpen/panelClose` 生命周期与 `event.source===iframe.contentWindow` 判据；针对迟到 open 的 close 写隔离测试，RED→GREEN。
- [ ] 跑目标测试、typecheck、构建；提交此任务。

## Task 3 — 抽屉弹窗与配置转场

**Files:**
- Modify `src/renderer/src/features/canvas/CanvasMarketPanel.tsx`
- Create `src/renderer/src/features/canvas/PluginDrawerPopup.tsx`
- Modify `src/renderer/src/features/canvas/canvas.css`
- Modify `src/renderer/src/features/canvas/PluginConfigurationControls.tsx`（仅加入成功关闭信号，不读回密钥）
- Test `src/renderer/src/features/canvas/pluginDrawerGate.test.ts` / new UI harness

**Interfaces:**
- `PluginDrawerPopup({plugin,panelId,onClose})` 用 native `<dialog>` 或顶层 portal；遮罩、关闭按钮、Esc 均关，内部点击阻止冒泡，卸载时 `PluginPanel` 自动 unmount。
- 卡片显示区用语义 button；开关和卸载为兄弟节点。多面板进入选择状态，选择后只挂载一个 PluginPanel。
- 进入 panel 前重新 `configuration('status')`；未配置或状态失败显示现有 `PluginConfigurationControls initialOpen`。配置成功关闭后再查一次状态，取消则只回抽屉。

- [ ] 先写可访问性/冒泡/层级测试并确认 RED。
- [ ] 实现 popup 与卡片入口，运行目标测试 GREEN；加入弹窗焦点恢复与多面板切换。
- [ ] 实现配置转场与错误提示，不记录/回显 key；测试未配置、取消、保存、锁定、已配置五路径。
- [ ] 跑 typecheck、build、目标测试；提交此任务。

## Task 4 — 隔离应用验收、文档与整分支审查

**Files:**
- Create `scripts/verify-plugin-drawer-popup.mjs`
- Create `docs/verification/plugin-drawer-popup/README.md` + screenshots/results
- Modify `docs/architecture/10-模块领地图.md`（面板入口与弹窗宿主边界）

- [ ] 构建并起隔离 Electron：使用临时 HOME/userData，绝不读真实密钥；验证无密钥安装后设置、取消、假密钥保存状态、卡片 popup、遮罩/按钮/Esc、工具按钮不误触；截图暗亮与窄屏。
- [ ] 验证 popup panelClose、迟到 open、popup canvas.call 拒绝、画布原面板照旧。
- [ ] 运行 `npm run check`、`npm run build`、`git diff --check`；失败原样记录，不放宽测试。
- [ ] 审查仅本次文件，更新架构图与验收说明，同一 commit 提交；不合并/推送/发版，除非用户另行要求。
