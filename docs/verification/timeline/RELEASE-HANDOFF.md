# 时间线插件 · 发版交接（2026-09-16）

用户要求：随 Eas-Term 内置分发，其他用户安装应用后即可使用，无需复制本机插件目录。

## 必须带入的变更
- 功能分支 `design/timeline-plugin-20260916` 的时间线提交（`feat(timeline): ship milestone plugin with low-token recording`）。
- `resources/plugins/timeline/` 整个运行目录，以及 pluginHost / mcpBridge / eas-plugin-shim / agentChat/session / timelineRuntime 的宿主集成。不能只复制 HTML。
- 本次仅合回本地 main；当前远端 main 与本地主分支已分歧，未授权 push，不自动推送。其他 worktree 请检查该提交是否为祖先，未包含则合入或 cherry-pick，不要假定本机可见就是发布已包含。

## 发布前检查
1. 检查安装包 resources/plugins/timeline 包含 plugin.json、server.mjs、lib/store.mjs、ui/panel.html、ui/icon.svg。
2. 干净用户目录下打开插件列表，时间线可见；打开面板并通过绑定插件的真实 AI 对话写入一条成果、更新同 taskKey 不重复计数。
3. 验证关闭再打开应用数据仍在，项目隔离正确，Windows 路径和 Node 启动可用。
4. 真实模型主动记录及下一轮遗漏提醒、Windows、正式安装包尚未验收，不能写成已通过。
5. 数据只在各项目 `.eas/timeline.json`，绝不把用户数据、测试项目、个人 ~/.eas/plugins 打入安装包。

## 已有证据
- 隔离开发应用 15 项检查通过，覆盖真实插件网关、写入刷新、去重、越界拒绝、详情、重载、粒子漂移呼吸/减少动效。
- result.json 与 wheel.png / wheel-motion.png / month.png / detail.png。
- 入口 scripts/verify-timeline.mjs；使用临时 profile/临时项目，不访问真实模型或凭证，不重启正式应用。
- 本机用户目录已按用户要求安装 ~/.eas/plugins/timeline；同名用户插件会覆盖内置插件，发布验收必须用干净 profile/用户插件目录，避免被这份本机副本误导。
