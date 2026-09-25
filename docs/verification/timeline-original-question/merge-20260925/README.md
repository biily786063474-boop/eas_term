# 合入 0.4.108 主线后复验（2026-09-25）

基线 `origin/main@7212623c`，合入 `feat/timeline-original-question-20260924@6b6c06f7`。仅文档末尾一处冲突，保留主线 AI 对话用量说明和分支时间线/插件面板说明；CSS 和 PluginPanel 自动合并，未删主线逻辑。

- `npm run check`：3694 项，3675 通过、19 跳过、0 失败。
- `npm run build`：成功。
- `EAS_VERIFY_OUTPUT=/tmp/eas-timeline-merge-verify node scripts/verify-global-timeline.mjs`：隔离真实 Electron 应用，时间线初始问题、候选确认、未选中插件鼠标透传及缩放等检查通过；`detail.png` 是合入后截图。
- `EAS_VERIFY_OUTPUT=/tmp/eas-plugin-merge-verify node scripts/verify-plugin-hot-update.mjs`：隔离真实 Electron 应用，运行中的目标插件弹出确认、停止后更新成功；`updated.png` 是合入后市场截图。原生弹窗由测试启动适配器记录内容并代为同意，未人工截图系统弹窗。
- 两轮应用验收都使用隔离 HOME/userData，没有替换用户安装版。正式应用发版仍是独立任务。
