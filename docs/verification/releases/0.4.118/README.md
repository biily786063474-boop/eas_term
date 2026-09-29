# 0.4.118 分发记录

## 源码
BASE_SHA 0559c11b → BUILD_SHA / main / tag v0.4.118 = 1b64cb1d121db140c26dbb3b6591f87725473fbb。发布树 /private/tmp/eas-release-0.4.118（独立干净树，Node 22.23.3 npm ci，npm audit 0）。Windows tag CI 36578157684 同 SHA success（含 smoke）；同 SHA main 重复 run 36584123171 已取消。推 main 前、切 latest 前、GitHub 公开前三次用 GitHub API 核对远端 main。

## 检查与验收
npm run check：4027 测试，4008 通过、19 跳过、0 失败；npm run build 成功。发布树构建上隔离实例 verify-bg-task-cd、verify-maximize-scale web、verify-mascot 全部通过（首次三项并跑时两个实例抢同一个 inspector 端口 9468 卡住，逐个重跑通过）。

## Mac
第一次 dist 在 omp mac-x64 下载 fetch failed 退出，未产出任何包；单独重试 omp 第 3 次成功后完整重打，产物全部来自重打。arm64 / x64 各 DMG+ZIP 签名、公证、staple；DMG 内 app spctl Notarized Developer ID，ZIP 内 app stapler 通过。正式包 smoke 两架构全过（node-pty 回显、随包 omp 18.1.2、无 JS 报错）。x64 为 Rosetta。

## 官网
- 五包逐个 scp 为 .part，SHA256 一致后转正（/www/wwwroot/eas-dl/v0.4.118/），哈希见 artifacts.json。
- 备份 /www/wwwroot/eas-release-backups/0.4.118-20260929T143901Z。线上三页替换前核对为 v0.4.117 原样；privacy 未动。
- changelog → index → download（临时名、哈希一致后替换），latest.json 最后；公网三页哈希一致，五个新包与 0.4.113 两个旧入口 Range 206，公网 latest 0.4.118、5 条 notes。
- PM2 五进程与七个站点状态前后一致（mini.biily.top 前后均 000，既有状态）；未 reload、未重启、未删旧包。磁盘可用约 6.3GB。

## GitHub
https://github.com/biily786063474-boop/eas_term/releases/tag/v0.4.118 ，2026-09-29T14:57:03Z 转正式并标 latest；五包 size/digest 一致（github-assets-final.json）。CI 自动建的同 tag 草稿未公开，保留。

## 未覆盖
真实在线模型端到端；实体 Windows/Intel；长时内存；外部 Computer Use 指针残留。Windows 未代码签名。未替换本机 /Applications/Eas-Term.app。
