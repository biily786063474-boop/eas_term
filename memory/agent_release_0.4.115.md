# 2026-09-28 Eas-Term 0.4.115 已双渠道发布
用户要求审查并发版，默认最新origin/main。初始6b6f72e4，审查发现Jev旧包恢复/时间线兼容问题；修复8151f415先合main，发布构建/tag为4b68502f8942ab0baf3d59e7780a227824818b18。
全量3971通过18跳过0失败，audit0；Jev旧12/新21真实Electron，Token/软件活跃UI与Codex五次安全恢复夹具通过。Mac ARM/x64签名公证/staple/Gatekeeper/DMG/ZIP实启通过，Intel为Rosetta；Windows36425319916同SHA成功。
官网五包逐文件scp+size/SHA256、三页面/latest/Range核验通过；GitHub2026-09-28T13:40:30Z公开latest，五包digest/size相同。生产五PM2+七站状态未变，未reload/重启/删旧包，约9.5GiB剩余。回退/www/wwwroot/eas-release-backups/0.4.115-20260928T131932Z。
证据docs/verification/releases/0.4.115/，Jev修复证据docs/verification/jev-legacy-release/。本轮发布记录只改文档，不移动构建tag。
边界：Jev0.2.0独立市场未发布，升级主程序不更新用户插件；外部Computer Use指针、真实在线模型/TypeSafe、真实一小时低内存/实体Windows/Intel未验。macOS12+，11用113；Windows未签名。正式用户应用和根脏工作树未触碰。
网络经验：npm audit曾卡在Clash代理，重试audit0；registry.npmjs.org增加源profile+runtime+热加载单域名DIRECT。YAML源规则是indentless list，初次多加两空格reload400未生效，改正后204且命中规则。密钥未打印/入库。
