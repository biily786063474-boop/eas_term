# 0.4.120 发布预检
- 源码：默认主线 origin/main 5500d6f66ecbc744632b46c3987ba982ce06a0c8，独立干净发布树 /private/tmp/eas-release-0.4.120；Node 22.23.3 独立 npm ci。
- npm audit：1 high —— node-forge（GHSA-86w9-cpqp-85rv，RSA PKCS#1 v1.5 **签名校验**接受多余嵌套 DigestAlgorithm，上游无修复版本；通告晚于 0.4.119 发布）。本项目只在 `src/main/phone/identity.ts` 用它**生成并签发**自签名证书（createCertificate / privateKeyFromPem / sign / certificateToPem），无任何 verify 调用，不经过受影响代码路径。记录在案，待上游修复后升级。
- 本版范围（相对 v0.4.119，主线 20 次合并）：英文界面 P0–T3（老用户保持中文）；skill「AI 自动发现」开关与 / 直接点名；后台运行独立提示音与标签；插件抽屉 logo / 系统插件归位 / 来源分组；作品画廊信息流；发布台插件 P1–P3；关于与开源致谢 + 第三方许可清单；效率工具分类；钥匙串按需访问；执行清单后台续轮；新对话清理旧会话信号；密钥柜小修；更新下载不排队；官网首页改版（中英）。
- 分发前审查：无新增依赖（package.json 只改脚本与 extraResources 许可文件）；签名/权限配置未改（build/ 只换 DMG 背景图）；新增代码无新出站请求（唯一 fetch 读随包的 third-party-notices.txt；发布台的平台链接均为用户点击打开，插件本身不联网）。
- 最终 npm run check：4312 测试，4293 通过、19 跳过、0 失败；i18n / 英文词条 / 图纸体积 / CSS / 动画检查全过；npm run build 成功（第三方许可清单 226 包）。
- 界面验收（发布树构建、隔离实例，逐个跑）：verify-skill-exposure 通过；verify-claude-background-running 通过；verify-i18n-p1 各界面残留中文 0 处，但灵动岛项未出现（未覆盖）；verify-plugin-drawer-popup **原脚本失败**：等「Jev 智能辅助」卡片超时 —— 插件已于 2026-09-28（629749c8）改名「Jev 判断台」，脚本过时，非本版回归；名称替换后同一流程全部通过（passed:true，含安装、取消配置、未配置先开配置）。脚本修正留到发版后在 main 上做。
- 官网版本号：下载链接与版本标记精确回填 0.4.119→0.4.120（保留 macOS 11 的 0.4.113 入口）；新首页的版本标签（中英各 17 处 v0.4.119）不在 publish-site.sh 的残留检查范围内，本次手动更新，脚本待补。
- 仍未覆盖：真实在线模型端到端（skill 开关在功能分支与合并结果上做过真实 Claude/Codex 会话验证）；实体 Windows / Intel；长时内存；外部 Computer Use 指针残留。
