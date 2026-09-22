# 用量抽屉与时间轴成果小票 · 2026-09-21

**真正修改位置：`/private/tmp/eas-timeline-integrate`（已有 main worktree）**。用户会话 cwd `/Users/biily/Biily/Projects/vibe coding/terminal` 是旧功能分支，不能把源码盲拷回去。所有本任务变更未 commit/push/install；正式版未动。

用户确认并已实现：
1. 用量项目点击就地展开，不再过滤全局仪表盘；项目独立分页。
2. 会话列表、每轮列表两层各显示3条，其余内部滚动；明细视觉弱化、区隔，并默认折叠。
3. Token 计费口径用户同意不改：已记录总处理Token包含缓存，不代表实际扣款/套餐额度。未知不补0。
4. 用量页周报/月报：自然周周一、自然月至今，Token主、已记录USD辅，复制图片/保存图片/复制文字；本地无AI调用。
5. 小票出纸：槽口内露出、层级高于机身，轻微透视弯曲/回落/暗面/阴影；导出保持平整。不能把纸层放回机身后面，否则看似从底部出来。
6. 时间轴底栏本周/上周＋打印周报。成果总数、当前三状态、有记录天数、项目数、筛选范围、项目前三、精选前三。按发生日、taskKey更新不重复；候选不计、部分项目不可读标不完整，不推算工时费用，不把当前状态说成本周状态变更。

共享：ReceiptDialog.tsx；UsageReceipt只载入计量；timelineReceipt.ts生成成果模板。receiptReport.ts输出共用SVG（名字必须避开UsageReceipt.tsx，macOS会先解析同名不同大小写.ts）。用量PNG880×1600，成果880×1920；usage:receipt仍固定尺寸、体积、PNG头、nativeImage、主窗口frame和guardPath限制。
时间轴桥：shared/pluginProtocol→PluginPanel核对source/握手/身份→pluginHost私有panel/timeline-report注入授权项目→server.mjs/weekly.mjs。没有新模型工具、没有扩大iframe权限。插件失效后拒绝旧报告返回。

重要排障：
- 原抽屉捕获mousedown会关闭body portal小票。CanvasWikiDrawer已将.ur-dialog计入内部范围；只用DOM.click会漏这个问题，须实际mousePressed/released。
- 全局margin reset让dialog贴左上，显式margin:auto。
- 原后台暂停动画策略保留，测试须激活自己所属实例。lsof必须只选LISTEN PID，否则PID回绕可能选到测试脚本客户端。
- CDP surface截图曾卡住/旧实例显示旧画面，重开所属隔离实例并fromSurface:false真机实拍；不能拿旧截图当已验证。
- 时间轴测试必须等store.projects加载后建Frame；必须走已有UI授权，空授权不绕过。

验证：typecheck/build通过；时间轴插件/面板/模板37项通过；verify-timeline-receipt.mjs真实隔离iframe链路、周切换/筛选/PNG复制/非法周期拒绝通过；verify-usage-receipt.mjs原小票真实鼠标回归通过；verify-usage-receipt-service.mjs真实PNG写出两种高度/取消/路径限制通过（仅系统保存对话框测试桩）。未验Windows和第三方聊天软件粘贴。证据见 docs/verification/{usage-project-expansion,usage-receipt,timeline-receipt}/。

时间轴体验实例以EAS_KEEP_OPEN=1 detached启动，状态 `/tmp/eas-timeline-receipt-instance.json`、日志 `/tmp/eas-timeline-receipt-experience.log`；PID/端口必须现场核对，脚本关闭后清理自身临时项目。另一个用量体验CDP9452可能还在，日志 /tmp/eas-usage-experience.log。不要全局kill。
