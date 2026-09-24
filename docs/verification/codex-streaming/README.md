# Codex AI 对话流式输出验收（2026-09-23）

- 范围：原生 `item/agentMessage/delta` 经桥接变成 `item.delta`、公共 `text.delta`；最终 `item.completed` 仍校准为 `text.done`。不改会话生命周期、IPC、UI、终端入口。
- 测试驱动：新增桥接、翻译与归约测试先红后绿。定向测试 122 通过、0 失败；`npm run check` 3612 通过、19 跳过、0 失败。
- `npm run build` 通过；`git diff --check` 通过。
- 隔离实例：使用 `/tmp/eas-codex-stream-verify-20260923` 用户目录启动本构建，进入测试项目的 Codex AI 对话界面；可见输入框、发送/历史/模型入口，页面没有可见错误。用户批准后发送一次简短真实模型请求。
- 真实验收：发送约 100 字中文回复请求；约 26.96 秒时，助手气泡先出现不完整正文；约 27.36、27.56 秒时继续增长；约 28.37 秒结束处理，最终仅一个完整气泡，没有重复。界面显示本轮输入约 19K、输出 84 tokens；该输入量由 CLI 自身上下文决定，非提示词字数。
- 限制：只验证本机 macOS、一轮真实 Codex 对话；旧版 Codex 无 delta、取消/续聊等由自动化测试覆盖，未逐一做线上模型调用。
- 差异范围：无 `session.ts`、`sessionState.ts`、launcher、IPC/preload、Claude/omp/终端代码改动。
