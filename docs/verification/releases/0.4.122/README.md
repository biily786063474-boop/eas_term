# 0.4.122 分发记录

## 源码
BASE_SHA bc85f41f（main：0.4.121 之后合入原生灵动岛宿主、使用手册帮助入口、Markdown 列表代码块、根目录遗留文档）→ BUILD_SHA / tag v0.4.122 = a18d2184ad9291c20847feb93324942a98592555。发布树 /private/tmp/eas-release-0.4.122（Node 22.23.3，~/.cache/eas-release-tools，npm ci）。Windows tag CI 36989684289 同 SHA success（含 CI smoke）。上线前复核 origin/main 仍为 bc85f41f，main 快进推到 a18d2184 后再切 latest。

## 检查与验收
见 preflight.md。npm run check 4364 测试，4345 通过、19 跳过、0 失败；build 成功；分发前审查无阻塞（5 条非阻塞残余已记）。界面验收见 ui/：md-list-code、i18n-p0（帮助菜单中英）、island-native-host 9 项、island-dock 12 项（观察项与合入验收一致）。

## Mac
arm64 / x64 DMG+ZIP 公证 + staple（.app 内票据 validate 通过）；spctl accepted / Notarized Developer ID；包内 IslandHost.app 为 Developer ID 签名 + hardened runtime（mac-gatekeeper.txt）。smoke 两架构各 9 项全过（x64 为 Rosetta）。

## 官网（服务器时间 2026-10-02 约 18:30–18:36）
手动流程（不用 publish-site.sh：KEEP=2 会删旧版本）。替换前复核线上 11 页与 main 基线一致（仅手册内版本号不同），备份 /www/wwwroot/eas-release-backups/0.4.122-20261002T103057Z。五包 .part → 大小+SHA256 → 转正（/www/wwwroot/eas-dl/v0.4.122/）；11 页临时名 + 哈希后依次换（index/download/changelog/manual 中英、llms*.txt），latest.json 最后（notes / notesEn 各 9 条）。公网 11 页哈希一致；五包与 0.4.113 两个 dmg 入口 206；latest 0.4.122。5 个 PM2 PID/状态/重启数与站点状态前后一致（mini.biily.top 前后均 000，既有状态）；未 reload/重启，未删旧包（113/120/121/122）。磁盘可用约 9.4G。

## GitHub
v0.4.122 于 2026-10-02T10:53:19Z 正式并标 latest（API 核对 releases/latest = v0.4.122），中英双语说明；五包大小与 sha256 digest 与 artifacts.json 逐个一致。上传经 Clash 节点，慢但未卡住，未改代理规则。

## 未覆盖
真实在线模型端到端；实体 Windows / Intel / macOS 12；多显示器与睡眠唤醒；长时内存；外部 Computer Use 指针残留。Windows 未代码签名。未替换本机 /Applications/Eas-Term.app。

## 待办
- 已在分支、未进本版：fix/plugin-card-overflow-20261002（插件抽屉卡片文字溢出）、fix/chat-image-viewer-20261002（对话图片居中/原图/缩放），合入 main 后随 0.4.123 发。
- 非阻塞残余（preflight.md）：相同内容连续审批共用 rev；原生宿主不 ready 时最坏约 55 秒无灵动岛；IslandHost Info.plist 无版本字段；publish-site 清理在 latest 读取失败时按未引用处理。
