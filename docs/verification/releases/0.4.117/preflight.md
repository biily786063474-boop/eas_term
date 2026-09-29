# 0.4.117 发布预检
- 源码：默认主线 origin/main 764499ab，独立干净发布树 /private/tmp/eas-release-0.4.117；Node 22.23.3 独立 npm ci，npm audit 0 漏洞。
- 本版范围（相对 v0.4.116）：像素团子吉祥物接入五处（灵动岛状态、AI 对话处理中/后台任务提示、任务监视器、空画布、AI 对话首页）；恢复带未完成后台任务的 Claude 会话时首条消息不再被空一轮提前结束；输入框键位提示变淡；任务清单卡片层级降到画布界面层之下；managedSymbols 测试去掉固定 5ms 等待。
- 分发前审查：逐项读 v0.4.116..764499ab 源码差异。无新增出站/依赖/权限；团子无 CSS 无限动画（check-animations 通过），隐藏/离屏/失焦/减弱动效停帧，灵动岛只按自身可见性停。
- 审查留意项（不拦发版）：absorbSelfInitiatedDone 在「用户消息等待回答」时吞掉 task-notification 那轮的结束；若 CLI 之后不再给用户消息单独出一轮结果，界面会停在「正在处理…」，需按停止键恢复。录制回放验证的是先空一轮、再回答的实测顺序。
- 最终 npm run check：4026 测试，4007 通过、19 跳过、0 失败；首跑 1 次 codexCapabilityConfig 偶发（测试只等文件出现、未等写完，本版未改动该文件），单跑 5/5 通过、全量重跑 0 失败。npm run build 成功。
- 界面验收（发布树构建、隔离实例）：verify-mascot（五处、暗/亮、动画闸门、灵动岛最小化仍动）、verify-claude-resume-notification、verify-composer-recall-hint（暗/亮对比度）、verify-plan-dock-z-order、verify-claude-background-running 全部通过。
- 仍未覆盖：真实在线模型端到端；实体 Windows/Intel；长时内存；外部 Computer Use 指针残留。
- 版本元数据：package/lock 0.4.117；CHANGELOG 与网页日志；下载页 0.4.116→0.4.117，保留 macOS 11 的 0.4.113 入口。
