# 0.4.116 发布预检
- 源码：默认主线 origin/main 05545d39，独立干净发布树 /private/tmp/eas-release-0.4.116；Node 22.23.3 独立 npm ci，npm audit 0 漏洞。
- 本版范围（相对 v0.4.115）：Claude 后台任务运行中反馈、终端 Claude 预放行 canvas_publish_report、浏览器最大化比例控件、输入框简化、AI 返回图片本地持久化与调整方向等待旧进程退出、匿名统计「在用时长」（隐私页同步）。
- 最终 npm run check：4017 测试，3998 通过、19 跳过、0 失败、0 取消；npm run build 成功。
- 界面验收：各功能分支在隔离 Electron 实例验收；chat-media-steer 此前缺的最终 UI 验收已于 05545d39 补完（图片 15 项、调整方向 2 项），证据见 docs/verification/chat-media-steer/。
- 仍未覆盖：真实在线模型端到端；「恢复原文件」系统选择框；实体 Windows/Intel；长时内存；外部 Computer Use 指针残留。
- 版本元数据：package/lock 0.4.116；CHANGELOG 与网页日志；下载页仅 0.4.115→0.4.116，保留 macOS 11 的 0.4.113 入口。
