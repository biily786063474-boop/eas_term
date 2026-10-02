# 0.4.121 分发记录

## 源码
BASE_SHA a4c316d8（0.4.120 官网上线后 main 合入 GitHub 只读插件）→ BUILD_SHA / tag v0.4.121 = 28a66a0a272088524e4432168143e8f0bd787d74，推 main 时远端快进到它。发布树 /private/tmp/eas-release-0.4.121（Node 22.23.3 npm ci）。Windows tag CI 36972546348 同 SHA success；同 SHA main 重复 run 36972542049 已取消（本机跟踪曾因 GitHub API 断线中断一次，重跟踪确认成功）。

## 检查与验收
npm run check：4319 测试，4300 通过、19 跳过、0 失败；build 成功。审查：fake-ip 放行（198.18.0.0/15、走代理按域名连接）为用户拍板的安全相关改动，残余风险见 preflight。隔离验收 skill-exposure / claude-background-running / plugin-drawer-popup（新名副本）通过；verify-github-plugin 需用户令牌未在发布树跑。

## Mac
arm64 / x64 DMG+ZIP 公证 + staple；spctl Notarized Developer ID；smoke 两架构各 10 项全过。

## 官网（2026-10-02 约 14:25 服务器时间）
**0.4.120 上线后另一会话以 --site-only 发布了使用手册**（manual.html、en/manual.html、llms*.txt、assets/manual-*.webp，并在各页导航/页脚加「使用手册」；源自其本地 main 509e5c7b，当时未推送）。为不冲掉它，本次 6 个页面（index / download / changelog 中英）用 git merge-file 以线上为底、只叠加 0.4.120→0.4.121 的改动，无冲突，手册链接保留（合并结果见 site-merged/）；隐私页本版未改，未传。上传前复核线上与备份一致。备份 /www/wwwroot/eas-release-backups/0.4.121-20261002T062534Z。五包 .part → SHA256 → 转正（/www/wwwroot/eas-dl/v0.4.121/），latest.json 最后。公网 6 页哈希一致、手册页 200、五包与 0.4.113 入口 206、latest 0.4.121。PM2 与站点前后一致；未删旧包（113/118/119/120/121），磁盘约 8.4G。

## GitHub
公开前 API 核对远端 main 已前进到 1c97a755（另一会话推送：原生灵动岛宿主、使用手册、帮助入口等 229 文件，已包含 0.4.121）。用户决定照样公开：v0.4.121 于 2026-10-02T06:46:39Z 正式并标 latest，中英双语说明，五包 digest 一致。新内容留待 0.4.122。

## 未覆盖
真实在线模型端到端；实体 Windows / Intel；长时内存；外部 Computer Use 指针残留。Windows 未代码签名。未替换本机 /Applications/Eas-Term.app。

## 待办
- main 修 verify-plugin-drawer-popup（Jev 已改名「Jev 判断台」）。
- publish-site.sh：下载链接通配回填会改掉 0.4.113 入口；残留检查不覆盖新首页 `win-ver` / `hero-req` 版本标签。
