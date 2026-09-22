# 插件更新补齐 · 2026-09-22

工作树 `.worktrees/plugin-update-release`，分支 `fix/plugin-update-release-20260922`。基于市场分支 7b4a273 合并 origin/main eda14a4（0.4.103）。根工作树含其他任务修改，绝不挪用。

已补：显式检查更新/更新，未知版本和内置副本「安装独立版」，同名遮挡警告，事件订阅权限声明与确认。保留现有下载hash、活动host门禁、IO失败回退。时间线版本1.0.0，要求mcp.stdio/events.agent-turn-completed与host>=0.4.103。

全量首次3499测试3失败（远程VM旧夹具没有新目录watch注入），修复为真实临时目录/watch，三专项过。全量复跑3499/3480pass/19skip/0fail，build过。UI notices继承ellipsis导致截断，改scoped换行、重建并亲眼核对。

真实应用隔离目录 `/tmp/eas-plugin-update-ui`，唯一bundle `com.biily.pluginupdate.verify` 避免误认其他Electron；临时home/profile+外层OSsandbox拒绝用户凭据目录，--no-sandbox只沿用嵌套Chromium测试环境参数。CUA实际点击验证无版本迁移、0.9.0→1.0.0、损坏包hash拒绝；历史fixture保留、global enabled false与epoch不变。一轮确认超过token期限被拒，重新确认后成功，未延长安全期限。最后CmdQ关闭所属实例；不要杀别人的Electron/CUA服务。

时间线独立包已发生产v2：release 85aa81d4-ab5f-477e-81ec-75b0a47c18c0。保留原6包，v1仍2包。发布staging `/tmp/eas-timeline-market-20260922/dist`，不可变timeline SHA a3b36fbe52565b31de1094ed133423fee576ce002bb00ce559ec564f9c4b0a77。公网逐包检查与服务比对见 docs/verification/plugin-marketplace/plugin-update。

正式 `/Applications/Eas-Term.app` 仍0.4.103旧v1市场，尚未替换/发新应用。必须下一步独立Node22 npm ci打包新host、正式包启动/多平台验收后再发布；当前本机~/.eas/plugins为空，别备份/修复不存在的旧timeline副本。暂保留资源目录作为独立包源；用户曾要求下版unbundle，发布实施时需检查host bundled imports与无插件状态/用户手动市场安装/旧面板状态，不得仅删除内置然后称完成。完整原32项仍未完成。
