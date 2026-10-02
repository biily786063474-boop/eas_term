# 0.4.123 分发记录

## 源码
BASE_SHA 283b2961（main：v0.4.122 之后合入插件卡片溢出修复、对话图片查看修复、0.4.122 发版记录）→ BUILD_SHA / tag v0.4.123 = 753a7740633bfe5367a83bd6eaaf59d67e621790。发布树 /private/tmp/eas-release-0.4.123（Node 22.23.3，npm ci）。Windows tag CI 36998717799 同 SHA success。上线前复核 origin/main 仍为 283b2961，main 快进推到 753a7740 后再切 latest。

## 检查与验收
见 preflight.md。npm run check 4371 测试，4352 通过、19 跳过、0 失败；build 成功。界面验收 ui/：verify-chat-image-viewer 与 verify-plugin-card-overflow 中英各 PASS。

## Mac
arm64 / x64 DMG+ZIP 公证 + staple；spctl accepted / Notarized Developer ID；IslandHost.app Developer ID + runtime（mac-gatekeeper.txt）；smoke 两架构全过（x64 为 Rosetta）。

## 官网
发版前先按用户同意删除 /www/wwwroot/eas-dl/v0.4.120（无引用，GitHub 仍有五包）。手动流程：替换前复核线上 11 页与 v0.4.122 发布内容逐字节一致；备份 /www/wwwroot/eas-release-backups/0.4.123-20261002T112040Z；五包 .part → 大小+SHA256 → 转正（/www/wwwroot/eas-dl/v0.4.123/）；11 页临时名 + 哈希后依次换，latest.json 最后（notes / notesEn 各 6 条）。公网 11 页哈希一致；五包与 0.4.113 两个 dmg 入口 206；latest 0.4.123。PM2 与站点状态前后一致（mini 前后均 000，既有）；未 reload/重启，未删旧包（113/121/122/123）。磁盘可用约 9.4G。

## GitHub
v0.4.123 于 2026-10-02T11:41:53Z 正式并标 latest（API 核对 releases/latest = v0.4.123），中英双语说明；五包大小与 sha256 digest 与 artifacts.json 逐个一致。

## 未覆盖
真实在线模型端到端；实体 Windows / Intel / macOS 12；长时内存；外部 Computer Use 指针残留。Windows 未代码签名。未替换本机 /Applications/Eas-Term.app。
