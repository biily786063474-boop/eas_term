# 0.4.122 发布预检
- 源码：origin/main bc85f41f3f3376d8b0f84ba4e81dad7adcd5b607，独立干净发布树 /private/tmp/eas-release-0.4.122；Node 22.23.3（~/.cache/eas-release-tools，SHASUMS256 校验）独立 npm ci。
- 本版范围（相对 v0.4.121）：macOS 正式版灵动岛改走原生 NSPanel 宿主（缺失/连续失败 5 次退回 Electron 岛）；灵动岛审批绑定请求版本 + 写回前现屏核对；通知窗口只作展示层；Dock 图标不再因灵动岛消失；帮助菜单与关于页的使用手册/更新日志入口（中英）；Markdown 列表项内代码块与编号连续。
- 分发前审查（独立 agent，只读）：无阻塞。非阻塞残余：①连续两条完全相同的审批共用 rev（内容相同，影响有限）；②原生宿主能启动但始终不 ready 时，最坏约 55 秒无灵动岛后才退回；③IslandHost Info.plist 无版本字段；④publish-site 清理在 latest.json 读取失败时按未引用处理（0.4.113 入口仍安全）；⑤mac 上误跑 dist:ci 会在签名闸门处失败（安全失败）。新增进程仅 IslandHost（CSP connect-src 'none'），新增外链仅帮助入口打开 eas.biily.top。
- npm audit --omit=dev：1 high，仍为 node-forge（GHSA-86w9-cpqp-85rv），评估同 0.4.120/0.4.121：只用于生成自签名证书，无 verify 调用。
- npm run check（升版本后）：4364 测试，4345 通过、19 跳过、0 失败；npm run build 成功。
- 界面验收（发布树、隔离实例，见 ui/）：verify-md-list-code PASS；verify-i18n-p0 通过（含 帮助/Help 菜单中英）；verify-island-native-host 9 项通过（含 dismiss 不抢前台、点任务回主窗口、外部全屏）；verify-island-dock 12 项通过（Electron 岛路径，观察项 dismissKeptForeground=false / taskClickFocused=false 与 2026-10-01 合入验收及纯净主线对照一致，为 Electron 岛既有问题，正式版 mac 默认已走原生宿主）。
- 仍未覆盖：真实在线模型端到端；实体 Windows / Intel / macOS 12；多显示器与睡眠唤醒；长时内存；外部 Computer Use 指针残留。
