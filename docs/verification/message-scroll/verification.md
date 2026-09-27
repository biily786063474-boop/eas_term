# 2026-09-27 阶段记录（未全部完成）

工作树：/private/tmp/eas-idle-recovery-20260927
分支：fix/chat-scroll-idle-recovery-20260927

已改：MessageList 的异步布局跟随；提取滚动状态控制器。保留手动上翻，不强制抢回底部。
通过：3 项纯函数测试；生产源码 typecheck；构建；隔离 Electron 4 项协议夹具 UI 验证（首次消息、晚到尺寸、历史阅读、回到最新）。已读取 latest.png 实机截图。
尚未验证：真实刷新后的持久化历史恢复、真实在线三 CLI、新消息到达与切换窗口交错、长时间 soak、Windows。
失败保留：通用 verify-agent-chat-ui 在断言 3 等待发送进入对话态超时（8000ms）；没有算通过。第一次专项 padding 尺寸变化失败，确认 ResizeObserver 默认 content-box 不观察 padding，改为 border-box 后专项通过。
并行跑 typecheck 曾碰到验收脚本临时 preload 补丁 TS2554；脚本还原后重跑通过。未放宽类型检查。

一小时自动恢复未实现：现有 did-navigate 会关闭所属 PTY/AI；缺跨模块落盘确认与准入原子性。设计见 docs/superpowers/specs/2026-09-27-idle-recovery-design.md，需确认后实施。不得报告整个需求完成。
没有提交、合并、发布。主工作区其他修改未动。
