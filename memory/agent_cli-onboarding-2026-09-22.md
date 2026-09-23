# CLI onboarding 实施交接 · 2026-09-22
- 用户已确认 Demo 后要求“写计划，然后落”；代码已实施在 .worktrees/plugin-update-release，基于 3546c13，未 commit/merge/push/release。
- 计划：docs/superpowers/plans/2026-09-22-cli-onboarding-production.md（根目录与工作区各一份）；报告：根 docs/prototype/2026-09-22-cli-onboarding-implementation.html。
- 新窗口级 CliSetupHost 由 App 常驻，面板入口只发请求。主进程 installSnapshot、代次/窗口取消校验、真实 close 后释放、错误分类、信号失败、程序探测错误。设置 AI 助手入口、模型菜单重入、草稿守卫。游戏引擎与独立弹窗。
- 实施测试：typecheck/build 通过；npm test 3532 total / 3514 pass / 18 skip / 0 fail。真实组件模拟 IPC + 隔离 Electron 已验证；完整应用 settings 入口截图。全新系统真实安装/授权/Windows taskkill 未验证。
- 只读独立评审五项已修正：取消卡住、误登录、窗口/代次归属、第二入口残留、历史 done 遮住重装。复核无剩余阻塞。
- 证据与可重跑脚本：工作区 docs/verification/cli-onboarding/，控制器注入测试 installLifecycle.test.mjs，纯函数 cliInstallPolicy/Feedback 与 snakeEngine 测试。
- 不能提交无关的 Computer Use 脏改动（docs/verification/releases/computer-use-lifecycle.md、computer-use/证据、对应 memory），不可整树 git add。
- 完整应用截图需 prefers-reduced-motion：既有后台动画暂停导致设置遮罩 opacity=0；没有改源代码绕过。组件验收不受影响。
- 下一步若用户要求提交，只挑本任务路径与对应架构图。若要真实验收，使用全新用户/VM环境，不能清除用户现有账号或安装。

## 20:54 截图反馈与当前待验包
- 用户在 Tart 旧待验构建中安装后看到 AI 对话启动卡片仍写“Codex · 未安装 / 安装并继续”，点击却进入登录；根因是弹窗直接 `cliAuth.check`，而 `AgentChatView` 使用 `agentChat:listClis` 的 60 秒缓存。现 `cliAuth/install.ts` 成功广播前失效 CLI 缓存，`AgentChatView` 收到安装 done 后刷新列表和登录态；关闭登录面板仍应显示“待登录 / 登录并继续”。不是简单改文案。
- `npm run check` 3541 总数、3523 通过、18 跳过、0 失败；`npm run build` 通过；隔离主应用实际打开、设置页渲染正常，但宿主 Claude/Codex 都已登录，无法在那里复现未登录卡片。新包签名、公证和 Gatekeeper 验证通过，app.asar SHA256 `a915c70f4a0dcb07342a1c42b737b8598b23e81a1d381fe396aca16f531b18f4`，专用 Tart 转运包 `/tmp/eas-clean-test-package-20260922/3.zip` SHA256 `78ba0a776d359003fcb9f98799e8099b25d676b66790f69e9398af517034728c`，本机网桥 `http://192.168.64.1:8765/3.zip` HTTP 200。
- **新包尚未进入 Tart，绝不能说已在 Tart 验收。** 当前 VM 仍 running，前台旧应用。Tart Guest Agent 不可用、SSH 22 拒绝；Computer Use 在客体 Safari 注入冒号映射成分号，URL 被当搜索，尝试文件/历史菜单和虚拟键盘仍未完成转运。不能绕过 guest 密码/FileVault；也不要把旧包当新包。此前临时把服务端 `1.zip` 指向 `3.zip`，已恢复原始 `1.zip`（原 SHA `cfa5cf...`）。后续可请用户在客体手动输入上面的新包 URL，或找不破坏隔离基线的转运方法，再核对客体包哈希并打开。
