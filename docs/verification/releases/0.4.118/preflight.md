# 0.4.118 发布预检
- 源码：默认主线 origin/main 0559c11b（GitHub API 核对），独立干净发布树 /private/tmp/eas-release-0.4.118；Node 22.23.3 独立 npm ci，npm audit 0 漏洞。
- 本版范围（相对 v0.4.117）：cd 开头的后台命令不再让 AI 对话一直显示运行中（reduce.ts countsAsOngoing，主进程空闲回收仍按整份列表）；文件 / 网页 / 插件面板节点最大化一律 1:1（--max-counter 反向 zoom，外框描边圆角同步，body 两条规则乘入）。
- 分发前审查：逐项读 v0.4.117..0559c11b 源码差异（6 个文件），无新增出站 / 依赖 / 权限，只动渲染层。
- 最终 npm run check：4027 测试，4008 通过、19 跳过、0 失败；npm run build 成功。
- 界面验收（发布树构建、隔离实例）：verify-bg-task-cd、verify-maximize-scale web、verify-mascot 全部通过。
- 已知限制：画布大于 100% 时网页最大化，页面读到的 devicePixelRatio 偏低（显示清晰，按 DPR 选图的页面可能取低清图）。
- 仍未覆盖：真实在线模型端到端；实体 Windows / Intel；长时内存；外部 Computer Use 指针残留。
- 版本元数据：package / lock 0.4.118；CHANGELOG 与网页日志；下载页 0.4.117→0.4.118，保留 macOS 11 的 0.4.113 入口。
