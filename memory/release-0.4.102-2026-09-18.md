# 0.4.102 发布进行中（2026-09-18）
用户已明确授权以最新版合入并发版、独立 worktree。
- 路径 `.worktrees/release-0.4.102`，分支同名。基线38ad965（0.4.101），挑入时间线62999d0→3caf679、Frame/返回图片fdafd0f→2cc91f1。产品发布准备76e2a3e已push。
- check3258：3239通过/19跳过；首次两项测试夹具冲突已修。build与开发/正式arm64四组UI（菜单、亮色、三CLI返回图、时间线）全过。正式arm64 smoke含PTY通过。
- Mac输出 `~/Eas-Term-release/0.4.102/`，原正式应用没动。arm64公证ID5fbe5e37-a7a7-43b5-a3f3-c7e57a6f2e73 Accepted，但staple网络失败error68，尚无dmg/zip；x64尚未打包。
- Windows CI35322170095产品SHA76e2a3e，API查询网络失败，不能断言通过。需要跟踪终态并下载eas-term-win。
- 线上仍0.4.101，未上传/未切换。服务器12G可用，八站200，五个pm2 online，无重启。日志 /tmp/eas-0102-*。
- 网络：Clash代理CDN对api.github.com/api.apple-cloudkit.com超时，DNS/query也超时；curl --resolve 到140.82.114.6和Cloudkit官方DNS返回17.248.193.57均TLS正常。排障中只添加这两个域名DIRECT规则/精确DNS策略与临时hosts pins（源profiles/rugEP9OJ9fOy.yaml、mWjE2ST7jCYf.yaml + clash-verge.yaml；备份后缀bak-eas0102-*）。**临时hosts块标记eas-0102 temporary，结束务必移除或明确告知。**没切换全局节点/没杀服务。源rules缩进2，runtime rules缩进0，不能混。
- 首次运行时YAML缩进不一致reload400，当场修正；随后204。之后DNS reload有一次超时，状态需核对。
- scripts/verify-{frame-picker,frame-light-header,chat-returned-images,timeline}.mjs新增EAS_VERIFY_EXECUTABLE/OUTPUT用于正式包验收，尚未提交。site三页和latest候选已本地回填，没发布。
- 需完成：网络/票据恢复→arm64 prepackaged打DMG+ZIP（不要重复公证）→x64签名公证打包/smoke→CI成功+五包hash→逐个scp/核验并先包后网页后latest切换，保留旧版无reload→GitHub release+main合入。外部Computer Use指针问题仍开放；未在线模型E2E。

## 01:30 后续
网络精确DNS pins恢复访问。Windows CI成功及EXE下载完成；Mac x64公证30523755-492f-4246-9628-738c5e2132ea Accepted。两架构smoke/签名/Gatekeeper通过；arm64正式包四组UI通过。builder显式--x64仍受配置arch影响重打arm64，x64 archive完成后停止冗余进程；交付arm64使用原已公证ZIP/DMG，ZIP解到verified-arm64并再次核对。/tmp/eas-0102-publish.py正按五包→三页→latest上传，日志/tmp/eas-0102-publish.log，不删旧版不reload。临时DNS pins仍待收尾移除。
