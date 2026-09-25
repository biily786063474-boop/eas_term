# 页面开发观察窗 · 隔离应用验收

2026-09-25，在独立工作树与临时 profile 中运行 `scripts/verify-live-page.mjs`；本机测试页由脚本的临时 HTTP 服务器提供，未连接用户账号或真实项目。使用与项目一致的 Electron 37.10.3 本地缓存二进制启动构建产物。

- `split-drawer.png`：分屏模式右侧观察抽屉，真实本地页面截图。
- `canvas-inline.png`：同一页面在画板 AI 对话 Frame 内临时分屏。
- `result.json`：31 条实际应用/MCP 操作断言，含进入/退出中间帧位移、跨会话拒绝、外网/file 地址拒绝、同会话并发导航拒绝、输入/点击、分屏/画板切换、切换会话或离开可见视图后暂停、弹出/返回、窄节点和减少动效。
- `npm run build` 成功；`npm run check`：3713 项测试，3694 通过、19 跳过、0 失败。

未验证：在线 Claude/Codex/OMP 模型自主触发工具、Windows/Linux 安装包、复杂开发服务器 HMR、亮色主题逐项视觉。观察窗不是外部 Chrome 同步；不会接管用户原有浏览器会话。
