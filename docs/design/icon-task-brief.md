# 图标接入子任务

工作树 /private/tmp/eas-agent-chat-codex。先读本文件及 docs/superpowers/specs/2026-09-07-icon-worktree-prototype.md、docs/design/eas-icon-prototype.json；这就是批准的要求。读 architecture/10 和 03 的相关边界。

实现 Task 2：共享原创双色 SemanticIcon、纯文件名映射、深浅主题 token；FileTree 文件/目录/新建行，BranchBadge，CanvasContextMenu 可选 leadingIcon（不能覆盖 hint）；公共 exec 可选 kind 从 Codex/Claude/omp 真实事件来源分类，贯通 reducer/history，旧数据 generic fallback。可以分块自行实施，不派子 agent。

不要改 AgentChatView.tsx、MessageList.tsx、ChatToolbar.tsx、agentChat.css、scripts/verify-agent-chat-ui.mjs，root 同时工作这些文件。交付需要 root 集成的最小片段/接口（位置图标、ExecRow 与 CompactDivider、菜单 leadingIcon）。文件图标和 BranchBadge 请自己接好。动作 refresh/mic/send 不换。

精确映射含 afterPack.js→JavaScript、PNG/ICNS→image、SVG→vector、plist→config、AGENTS/CLAUDE.md→agent规则、TS、Markdown、JSON、Git、unknown；目录按开合。worktree 菜单原有禁删/确认/脏保护不得修改。不要从 CLI label/自然语言猜类型，用可靠事件名/工具名，可不知道。

测试语义分类和可选类型兼容；不要跑 npm install、整套 build 或临时 preload UI 测试，不 commit。报告保存 docs/design/icon-task-report.md，仅回状态/测试和集成接口。root 负责架构综合更新和视觉验证。
