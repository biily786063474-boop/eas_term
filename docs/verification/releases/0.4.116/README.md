# 0.4.116 分发记录

## 源码
BASE_SHA 05545d39 → BUILD_SHA / main / tag v0.4.116 = 7e1a5f99283db6dfc50a4381f454e455a56fd0ed。发布树 /private/tmp/eas-release-0.4.116（独立干净树，Node 22.23.3 npm ci）。Windows tag CI 36453579266 同 SHA success（含 smoke）；同 SHA main 重复 run 36453572921 已取消。上传包前、切 latest 前、GitHub 公开前三次核对远端 main 均等于 BUILD_SHA。

## Mac
arm64 / x64 各 DMG+ZIP 由 BUILD_SHA 本地构建，Developer ID 签名、公证、staple；DMG 与 ZIP 内 app 均 stapler validate 通过、spctl `Notarized Developer ID`。正式包 smoke 两架构全过（preload 61 命名空间、node-pty 开终端回显、随包 omp 18.1.2、无 JS 报错），见 mac-*-smoke.txt/png。x64 在 Rosetta 下运行，非实体 Intel。首次打包 omp mac-x64 下载 fetch failed，单独重试成功后完整重打，产物全部来自重打那次。

## 官网
- 五包逐个 scp 为 `.part`，远端 SHA256 与本地一致后转正式名（/www/wwwroot/eas-dl/v0.4.116/）。哈希见 artifacts.json。
- 备份 /www/wwwroot/eas-release-backups/0.4.116-20260928T172905Z（旧 index/download/changelog/privacy/latest.json）。
- 页面依次切换 privacy → changelog → index → download（临时名、哈希一致后替换），latest.json 最后。公网四页哈希与仓库一致；五个新包与 0.4.113 两个旧入口 Range 206；公网 latest version 0.4.116、10 条 notes。
- 隐私页按用户决定整页换为仓库新版（线上此前为 0.4.0 旧版，未申报已上报的使用龄字段，且含已不成立的「代码和对话不出本机」表述）；新版含标注「开发中/尚未发布」的插件说明。
- PM2 五进程 PID/状态/重启数、站点状态前后一致（mini.biily.top 发布前后均为 000，属既有状态）；未 reload、未重启、未删旧包（111/113/114/115 保留）。磁盘可用约 9.0GB。

## GitHub
https://github.com/biily786063474-boop/eas_term/releases/tag/v0.4.116 ，2026-09-28T17:32:11Z 由草稿转正式并标 latest；五包 size/digest 与本地一致，见 github-assets-final.json。

## 未覆盖
真实在线模型端到端；「恢复原文件」系统选择框；实体 Windows/Intel；长时内存；外部 Computer Use 指针残留。Windows 安装包未代码签名。未替换本机 /Applications/Eas-Term.app。
