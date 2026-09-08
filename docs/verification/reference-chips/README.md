# 输入框引用 chip 验证 · 2026-09-07

正文 @ 引用改为按类型着色的原子 chip，悬停或键盘聚焦展示详情。启动屏辞典候选行增加上 12px、左右 16px 内边距。启动与对话页共用同一编辑器，覆盖 Codex、Claude、omp。

## 发送边界

- 辞典展示实际展开提示词；文件、目录、技能和网页展示原有引用文本。
- 插件展示描述、引用文本及绑定说明，引用不建立新连接。
- 图片附件和图片文件引用展示原图，以及各自实际发送的路径/引用文本。
- 文档仍保存纯文本，视觉标签不参与发送。没有新依赖、IPC、出站请求、历史格式或 CLI 传输改动。

## 验证

- `npm run check`：2,537 通过，0 失败，1 跳过（共 2,538）。
- `node scripts/verify-agent-chat-ui.mjs --composer`：160 项通过，覆盖三个 CLI × 启动/对话页、浅深主题、原子删除与撤销、精确发送、失败恢复、成功后撤销边界、长文、中文 IME、复制粘贴、插件与图片预览、压缩确认。
- `node scripts/verify-agent-chat-ui.mjs --composer --faults-only`：39 项通过。
- 基础对话 UI 与模型/effort 兼容回归另行通过，保留 JSON 记录。
- 真实 Electron/React 与本地辞典/图片 API；发送、插件候选及故障使用隔离夹具，没有调用真实模型。
- 独立只读复查未发现剩余明确缺陷。测试后还原 preload 并重新构建生产产物。

结果：`results.json`、`faults-results.json`；截图见同目录。生产产物启动屏截图另存 `production-startup.png`。
