# 0.4.124 发布预检
- 源码：origin/main（发版提交前 rebase 到含 cfaf6b2e 的最新主线），独立干净发布树 /private/tmp/eas-release-0.4.124；Node 22.23.3（~/.cache/eas-release-tools）npm ci。
- 本版范围（相对 v0.4.123）：发布台分屏（panel/split.open、companion 头条、hidden 面板）、发布台面板跟随数据刷新与新版式/平台标志、插件面板跟随主题、网页节点默认白底按 color-scheme 换深色、AI 对话 Enter 发送（另一会话）、手机端 Markdown/HTML 报告/中英/处理中/回到最新/历史续接（另一会话）、0.4.122 审查遗留五条。发布台 0.1.2 的 minHostVersion 随本版改为 0.4.124（不提前改 main：0.4.123 开发版会拒载内置副本）。
- 分发前审查（独立 agent，只读）：无代码阻塞。发现「复制分屏格子 → 7 格 → 再次分屏打开抛 TypeError」→ 已在 main 修复（cfaf6b2e，duplicateNode 去掉 companion + applySplit 超 6 格只排最近 6 格，含测试）后重新定基线。其余非阻塞：市场安装确认未列 permissions.split（split 无超出 ui/open-link 的能力）；手机读历史按 key 白名单而非会话归属（越权读需猜中 key，未证实可利用）；手机 HTML 报告继承父页 CSP，外链脚本 / 图片会被拦（功能限制）；旧版本打开新存档时分屏格子会占内容名额；宿主 split 错误文案仅中文；guestCanvas 对被改写的 getComputedStyle 未防御（不影响功能）。
- 手机回归脚本：本机在 10a 前稳定复现 fetch ECONNRESET —— 诊断为 undici 复用服务端正在关闭的 keep-alive 连接（3 秒后同地址 200；Clash 连接表无该流量），脚本加一次重试后 41/41 通过（修复已进 main）。
- 界面验收（发布树、隔离实例，见 ui/）：verify-publish-desk-split PASS、verify-publish-desk-live PASS、verify-webview-canvas 普通页白 / 深色页 #121212、verify-chat-enter 通过（含英文）、verify-phone-api 41/41（含英文）。
- 仍未覆盖：真实在线模型端到端（手机回归会拉起真实 Claude 但只几句）；实体 Windows / Intel / macOS 12；多显示器；长时内存；外部 Computer Use 指针残留。
