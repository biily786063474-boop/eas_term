# 多市场源接入 · 2026-09-22 04:05 后

用户明确目标为「接入其他插件市场：用户添加市场源、浏览安装，并从原市场更新」，不是原32插件清单。已发异步问题询问首个市场名称/公开目录或仓库地址，尚无回答；不能把仅支持Eas registry称任意Claude/Codex市场兼容。

工作树仍 `.worktrees/plugin-update-release`，基线提交8619c18（上一轮更新机制与时间线独立发布）。本轮未提交文件：docs/superpowers/plans/2026-09-22-multi-market-sources.md、src/main/pluginMarketSource.ts/test.ts、本memory。

当前只有纯逻辑基础：规范化公开HTTPS目录URL→稳定SHA来源身份（拒凭据/查询参数/片段/IP/本地域），更新须精确绑定原sourceId、未知来源不自动推断。先模块缺失红灯（/tmp/eas-multi-market-red.log），后2测试绿；尚未接持久化/IPC/下载/安装收据/UI，未构建眼验，未发布，不算多市场功能完成。

计划按来源管理→安全下载缓存→宿主安装收据原子晋升→同名冲突与来源移除代次→UI→真实市场适配验收实施。外部网络必须复用pluginConnections的DNS公开地址与连接固定/TLS/代理约束，不能把ALLOWED_HOSTS直接变成任意输入域名。现有插件路径按name且宿主授权也按name，所以本期拒同名跨源共存/覆盖，不随意改运行时身份。

首个实际市场格式会决定适配器（Eas v1/v2与Claude/Codex marketplace并非通用）。先确认真实目标，避免把用户所说其他市场错误缩成自己新定义的一种目录。

## 04:18后范围收窄与实施
用户说「留口子就行，用户可以通过这个口子接外面的插件进来」。不再等首个市场，不要求逐家适配。已实现通用Eas目录入口：pluginMarketSource store、native确认、sources IPC/preload、完整市场来源选择/表单/移除、外部安全下载、原子包内来源收据/更新绑定与移除代次失效。新增16专项通过；尚在最终全量与CUA验收。格式边界文档 docs/knowledge/external-plugin-source-contract.md，不宣称任意外部插件平台直接兼容。本机eas域名DNS是Clash198.18fake-IP，保留拒绝；真实外部互联网安装不应冒充已验证。

最终check/build退出0：3505/3486pass/19skip/0fail。CUA真实应用验收来源入口/表单/原生添加确认/配置落盘/下拉切换/网络失败说明/移除原生确认与数据保留。实际公网请求被Clash fake-IP保护拒绝，所以没有外部公网安装成功结论；正向原源安装/更新/去源commit拒绝在真实IPC+临时FS+确定性网络夹具通过。完整记录 external-sources/README.md。UI首次getApp路径超时，unique bundle ID选择成功；正式app仍未发版。

## 2026-09-22 04:50 公网第一项完成
DNS根因已按单域名修复：当前Clash merge源fake-ip-filter + rules源DOMAIN,eas.biily.top,DIRECT +运行时配置同步，reload204后系统DNS真实39.105.40.173，产品安全守卫不变。私有备份在原配置旁.eas-source-20260922.bak，禁止进仓。
独立公网目录 /plugins/verification/external-20260922-a/registry.json，CUA真实应用走外部来源添加/选择/HTTPS安装market-live-check1.0.0→服务器目录切1.1.0→同一进程检查更新/确认/显示1.1.0。无网络替换，来源收据未变，历史与关闭全局记录的配置hash未变。两ZIP公网完整字节匹配；生产v1/v2目录及5PM2 PID/status未变，测试实例退出0。证据external-sources/public-live/。
本项完成不代表主程序已发版：/Applications仍0.4.103；时间线去内置与主程序合并发布仍待做。本次无产品代码修改。

## 2026-09-22 时间线离线平滑迁移（用户明确选择）
新增pluginMigration.ts及9专项；package extraResources将时间线分到plugin-migrations/timeline，正常扫描排除builtin timeline。启动固定路径离线原子晋升+官方receipt+home/.eas完成标记；用户旧副本不覆盖、不追认来源，卸载后不复活，历史/授权/开关不改。失败使用有标注恢复副本；强杀残锁保守拒绝，需核查所属后清理，未实现自动抢锁。
check3514/3495pass/19skip/0fail，build0；CUA真实应用看到独立时间线、迁移前成果、全局记录关闭；同profile退出重启旧面板恢复，history/grants/manifest SHA不变，两次launcher0。electron-builder实际FileMatcher排除timeline验证通过。证据docs/verification/plugin-marketplace/timeline-independent/。
尚未主程序合并/发布；正式0.4.103未动；签名/公证/Windows真实包迁移路径必须发版时复验。本轮源码与证据尚待提交。

## 2026-09-22 05:10 最新主线同步核查
用户要求合并最新主线。git fetch origin main成功，最新仍eda14a4；当前分支已包含它（HEAD...origin/main=61/0），无新增主线代码需要处理。重新check3514/3495pass/19skip/0fail，build通过。将前轮未提交迁移实现、图纸与公网/迁移验收证据一起提交。此次不移动main、不push、不发版；根工作区未提交改动不碰。
