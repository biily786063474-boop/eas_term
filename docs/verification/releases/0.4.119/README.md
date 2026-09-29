# 0.4.119 分发记录

## 源码
BASE_SHA 46442205 → BUILD_SHA / main / tag v0.4.119 = 1cb37bd2198a0193a56157897f18b0039c4a52c8。发布树 /private/tmp/eas-release-0.4.119（Node 22.23.3 npm ci，audit 0；omp 18.1.2 复用 0.4.118 发布树同版本产物）。Windows tag CI 36593642396 同 SHA success（含 smoke）；同 SHA main 重复 run 36597386680 已取消。推 main 前、切 latest 前、GitHub 公开前用 GitHub API 核对远端 main。

## 检查与验收
npm run check：4027 测试，4009 通过、18 跳过、0 失败；build 成功。verify-claude-background-running 通过；verify-bg-task-cd 断言全过、收尾挂住被 300s 限时结束（exit 142）。

## Mac
第一次 dist 在 codesign 时 timestamp.apple.com 不可用（The timestamp service is not available）未出包；规则表该域名本就 DIRECT，试签探针通过后完整重打，产物全部来自重打。两架构公证/staple/spctl Notarized Developer ID，正式包 smoke 全过（x64 为 Rosetta）。

## 官网
五包 .part → SHA256 → 转正（/www/wwwroot/eas-dl/v0.4.119/），备份 /www/wwwroot/eas-release-backups/0.4.119-20260929T162426Z，三页替换前核对为 v0.4.118 原样，latest.json 最后；公网三页哈希一致，下载链接 Range 206，latest 0.4.119。PM2 与站点前后一致。发布后按用户同意清理旧包：删除 v0.4.111/114/115/116/117，保留 113/118/119，磁盘 5.2G → 11G。

## GitHub
v0.4.119 于 2026-09-29T16:43:24Z 转正式并标 latest；五包 size/digest 一致（github-assets-final.json）。

## 未覆盖
真实在线模型端到端；实体 Windows/Intel；长时内存；外部 Computer Use 指针残留。Windows 未代码签名。未替换本机 /Applications/Eas-Term.app。
