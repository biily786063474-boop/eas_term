# 0.4.121 发布预检
- 背景：0.4.120（BUILD 7f1f3c4a）官网已于 2026-10-02 上线后，main 前进到 a4c316d8（GitHub 只读插件 + fake-ip 放行 + 插件用法引导）。按发版规则在 GitHub 公开 0.4.120 前停下，用户选择直接发 0.4.121；0.4.120 的 GitHub Release 保持草稿。
- 源码：origin/main a4c316d82b19f55cadd144878dfb1640943a246e，独立干净发布树 /private/tmp/eas-release-0.4.121；Node 22.23.3 独立 npm ci。
- npm audit：1 high，仍为 node-forge（GHSA-86w9-cpqp-85rv），评估同 0.4.120：只用于生成/签发自签名证书，无 verify 调用。
- 本版范围（相对 v0.4.120）：远程插件支持访问令牌连接（系统加密保存、不回显、测试连接、关插件即断开已绑定会话）；三处入口「新开接好插件的对话」与 @ 插件提示；代理 fake-ip 下远程插件可连。
- 分发前审查：无新增依赖；build/ 与签名未改；新代码无新出站调用（远程插件只连插件清单声明且用户安装、配置过的地址，如 api.githubcopilot.com）。**安全相关改动**（用户拍板）：`endpointPolicy` 不再拦 198.18.0.0/15（RFC 2544 基准段，实际为 Clash/Surge fake-ip），其余私网段仍拦（有测试）；走系统代理时按域名连接、不再用本地 DNS 结果做内网判断，域名白名单不变（测试「proxy never bypasses the origin allowlist」）。残余风险：插件声明的域名若被劫持解析到内网，走代理时本地不再拦截。
- 最终 npm run check：4319 测试，4300 通过、19 跳过、0 失败；npm run build 成功。
- 界面验收（发布树构建、隔离实例）：verify-skill-exposure、verify-claude-background-running 通过；verify-plugin-drawer-popup 用「Jev 判断台」新名替换副本跑，passed:true（原脚本仍是旧名，待在 main 上修）。verify-github-plugin 需用户真实令牌，未在发布树跑；功能分支上已用真实账号 17 项全过（docs/verification/plugin-marketplace/github/）。
- 仍未覆盖：真实在线模型端到端；实体 Windows / Intel；长时内存；外部 Computer Use 指针残留。
