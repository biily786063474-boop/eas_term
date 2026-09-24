# AI 对话消息间距验收 · 2026-09-23

用户截图中的间距由三处叠加：消息容器 gap 为 24px、吸顶占位仍按 14px 抵消；Markdown 回答继承 `white-space: pre-wrap`，额外展示渲染器块间换行；纯文本工具调用生成空媒体容器。

基线隔离 Electron 测量：用户消息至 AI 回复 34px，两个 Markdown 段首相隔 62px（单行段落高度约 25px），工具调用前还有空媒体行。

修复后 `node scripts/verify-agent-chat-ui.mjs --spacing` 在隔离 Electron 的真实 `MessageList` 中通过：用户→AI 14px、AI→工具区 10px、Markdown 段落净间距 12px、空媒体行 0。数据见 `metrics.json`，截图见 `after.png`。源码构建及 `npm run check` 通过（3608 通过、19 跳过、0 失败）。

通用 UI 验收脚本（未加 `--spacing`）未全程通过：首次在 100ms 等待工具详情离场时误报“未收起”，复跑又曾在 Node B 发送按钮稳定点击/首轮焦点检查超时；这几项不属于本次间距专项，未将其计为通过，也未在产品代码中叠加修补。正式用户窗口未替换。
