# 0.4.117 分发记录

## 源码
BASE_SHA 764499ab → BUILD_SHA / main / tag v0.4.117 = 1c026153c8bd6b4f8dff71057e25c45f4c603965。发布树 /private/tmp/eas-release-0.4.117（独立干净树，Node 22.23.3 npm ci，npm audit 0）。Windows tag CI 36532715599 同 SHA success（含 smoke）；同 SHA main 重复 run 36535409860 已取消。上传包前、切 latest 前、GitHub 公开前三次核对远端 main 均等于 BUILD_SHA。

## 检查与验收
npm run check：4026 测试，4007 通过、19 跳过、0 失败（首跑 codexCapabilityConfig 1 次既有偶发，重跑干净）；npm run build 成功。发布树构建上隔离实例跑 verify-mascot / verify-claude-resume-notification / verify-composer-recall-hint / verify-plan-dock-z-order / verify-claude-background-running 全部通过，截图已目视。

## Mac
arm64 / x64 各 DMG+ZIP 由 BUILD_SHA 本地构建，Developer ID 签名、公证、staple；DMG 内 app stapler validate 通过、spctl Notarized Developer ID，ZIP 内 app stapler validate 通过。正式包 smoke 两架构全过（preload 61 命名空间、node-pty 开终端回显、随包 omp 18.1.2、无 JS 报错），见 mac-*-smoke.txt。x64 在 Rosetta 下运行，非实体 Intel。

## 官网
- 五包逐个 scp 为 .part，远端 SHA256 与本地一致后转正式名（/www/wwwroot/eas-dl/v0.4.117/）。哈希见 artifacts.json。
- 备份 /www/wwwroot/eas-release-backups/0.4.117-20260929T071621Z（旧 index/download/changelog/latest.json）。线上三页替换前核对为 v0.4.116 原样；privacy 与仓库一致未动。
- 页面依次切换 changelog → index → download（临时名、哈希一致后替换），latest.json 最后。公网三页哈希与仓库一致；五个新包与 0.4.113 两个旧入口 Range 206；公网 latest version 0.4.117、7 条 notes。
- PM2 五进程 PID/状态/重启数、七个站点状态前后一致（mini.biily.top 前后均 000，既有状态）；未 reload、未重启、未删旧包（111/113/114/115/116 保留）。磁盘可用约 7.4GB。

## GitHub
https://github.com/biily786063474-boop/eas_term/releases/tag/v0.4.117 ，2026-09-29T07:35:25Z 由草稿转正式并标 latest；五包 size/digest 与本地一致，见 github-assets-final.json。Windows CI 自动建的同 tag 草稿（仅 exe）未公开，保留未删。

## 未覆盖
真实在线模型端到端；实体 Windows/Intel；长时内存；外部 Computer Use 指针残留。Windows 安装包未代码签名。未替换本机 /Applications/Eas-Term.app。
