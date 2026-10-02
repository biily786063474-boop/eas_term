# 插件用法傻瓜式引导 · 新用户视角验收（2026-09-30）

脚本：`scripts/verify-plugin-onboarding.mjs`（隔离 profile，CDP 发真实点击和键盘事件，不调用 store 捷径）。
令牌：`eas-secret run --vars GITHUB_READONLY_TEST_TOKEN -- node scripts/verify-plugin-onboarding.mjs`，令牌不进截图、不进日志（最后一项专门检查）。

结果：14 项全部通过，见 `result.json`。

| 截图 | 看什么 |
|---|---|
| 01-market | 从侧边「插件」→「查看完整插件市场」进来 |
| 02-config-opened | 安装后直接弹配置，有「获取密钥」按钮和获取令牌的步骤说明 |
| 03-get-token-page | 在软件内打开的 GitHub 令牌创建页，已预填名称、30 天到期和只读权限 |
| 04-saved | 保存后配置窗口还开着 |
| 05-connected | 测试连接通过，出现「开始对话 →」 |
| 06-chat-opened | 新对话里预填了示例问题，没有自动发送；标着「GitHub（只读）· 已接好」 |
| 07-answered | AI 调用了 `mcp__github__get_me` / `search_repositories` / `list_commits` 回答 |
| 08-drawer-card / 09-drawer-chat | 抽屉里的 GitHub 卡片写着「点击开始对话」，点它新开一个接好插件的对话 |
| 10-at-hint | 输入框 @ 候选 |

已知限制：
- @ 里的插件提示这次没有真正触发。测试 profile 里没有被禁用的插件，所以提示没出现。文案只改了字典（`chat.pluginBindHint`），这一项未实测。
- 第一版示例问题「看看我最近在忙哪个仓库」没有点名 GitHub，AI 去读了本地目录，没有调用插件。现在改成「用 GitHub 插件看看……」，重跑后通过。
