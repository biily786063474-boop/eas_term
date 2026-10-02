# 0.4.120 分发记录

## 源码
BASE_SHA 5500d6f6 → BUILD_SHA / tag v0.4.120 = 7f1f3c4a49b27f689a9bc20456eda76d4da4dc62（推 main 时远端 main 5500d6f6 快进到它）。发布树 /private/tmp/eas-release-0.4.120（Node 22.23.3 npm ci）。Windows tag CI 36967386531 同 SHA success（含 smoke）；同 SHA main 重复 run 36967400639 已取消。

## 检查与验收
npm run check：4312 测试，4293 通过、19 跳过、0 失败；build 成功。npm audit 1 high（node-forge，签名校验缺陷，本项目只生成证书不校验，见 preflight）。隔离验收 skill-exposure / claude-background-running / i18n-p1 通过；plugin-drawer-popup 原脚本因 Jev 改名过时失败，替换新名后通过。首次跑验收脚本时它们覆盖了仓库里已有的验证证据，已全部恢复，新结果放 ui/。

## Mac
首次 notarytool 报 403（Apple 开发者协议过期），用户签署新协议约 2.5 分钟后生效。arm64 / x64 DMG+ZIP 公证 + staple；DMG 内 app spctl Notarized Developer ID，ZIP 内 app stapler 通过；正式包 smoke 两架构全过（node-pty 回显 616 字节，x64 为 Rosetta）。

## 官网（2026-10-02 约 13:20 服务器时间）
备份 /www/wwwroot/eas-release-backups/0.4.120-20261002T051820Z；替换前核对五个旧文件与 v0.4.119 逐字节一致。五包 .part → SHA256 → 转正（/www/wwwroot/eas-dl/v0.4.120/）。首次上线新首页（中英）与英文站：新增 appui.css / dango.js / home.css / home.js / scenes.css 与 en/ 四页，改 index / download / changelog / privacy / style.css，逐个临时名 + 哈希后替换，latest.json 最后。公网 11 个页面哈希一致，五包与 0.4.113 两个旧入口 Range 206。PM2 与站点前后一致；未 reload、未删旧包。下载链接按版本精确回填，保留 macOS 11 的 0.4.113 入口（publish-site.sh 的通配回填会误改它）；新首页 34 处版本标签不在脚本残留检查范围内，手动更新。

## GitHub
公开前用 API 核对远端 main，发现已前进到 a4c316d8（GitHub 只读插件），按规则停止公开；用户选择直接发 0.4.121。0.4.121 发布后，按用户决定把 v0.4.120 作为普通历史版本公开（2026-10-02T06:46:33Z，不标 latest），五包 digest 一致（github-assets-final.json）。

## 未覆盖
真实在线模型端到端（skill 开关在功能分支做过真实会话验证）；实体 Windows / Intel；长时内存；外部 Computer Use 指针残留。Windows 未代码签名。未替换本机 /Applications/Eas-Term.app。
