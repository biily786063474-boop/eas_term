# 0.4.119 发布预检
- 源码：默认主线 origin/main 46442205（GitHub API 核对），独立干净发布树 /private/tmp/eas-release-0.4.119；Node 22.23.3 独立 npm ci，npm audit 0；omp 18.1.2 复用 0.4.118 发布树已下载的同版本产物。
- 本版范围（相对 v0.4.118）：AI 一轮结束即提示「有结果等你看」，后台任务仍在跑时运行态与「后台任务运行中」保持（AgentChatView：去掉 background 为空的前置条件；过期判断按最新视图的 busy；lastDoneAt 两边按 ?? 0 比较）。
- 分发前审查：v0.4.118..46442205 只动 AgentChatView.tsx 与对应验收脚本、03 号图纸；无新增出站 / 依赖 / 权限。
- 最终 npm run check：4027 测试，4009 通过、18 跳过、0 失败；npm run build 成功。
- 界面验收（发布树构建、隔离实例）：verify-claude-background-running 通过；verify-bg-task-cd 断言全部通过，但脚本收尾清理阶段挂住，被 300s 限时结束（exit 142）。
- 仍未覆盖：真实在线模型端到端；实体 Windows / Intel；长时内存；外部 Computer Use 指针残留。
