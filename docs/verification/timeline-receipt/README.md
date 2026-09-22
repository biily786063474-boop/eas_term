# 时间轴成果小票验收 · 2026-09-21

工作树 `/private/tmp/eas-timeline-integrate`；未提交、未安装正式版。

- typecheck/build 通过。
- 时间线插件、面板协议、成果模板和用量模板定向测试 37 通过；包含跨月/本周/上周、205 条跨分页、重复成果更新、候选不计、空筛选、未授权项目与不可读项目。
- `verify-timeline-receipt.mjs`：独立临时 userData + 两个临时项目；按现有授权流程开启，只用模拟成果，未调用模型。真实 iframe → 宿主 → 插件 → 共享 dialog；本周3项、上周1项、筛选后1项、状态分类、正文证据排除、PNG复制、非法周期拒绝通过。
- `verify-usage-receipt.mjs`：原用量周/月小票、槽口出纸、真实鼠标复制、Esc、reduced-motion 回归通过。
- `verify-usage-receipt-service.mjs`：PNG复制、1600/1920高小票保存、取消、非法数据和路径守卫通过；系统保存对话框为测试桩，其余为真实 Electron IPC/文件/剪贴板。
- 实拍 `weekly.png`；完整880×1920 PNG 为 `receipt.png`，已亲眼检查全张内容。数据为fixture，不是真实工作量。

初次失败如实记录：测试启动太早，store项目尚未加载就建Frame，导致cwd为空；改为等待项目加载。新账号尚无时间轴授权时返回0；按既有UI授权再验，产品没有绕过授权。用量测试以lsof返回首PID选择实例，在PID回绕后选到了测试脚本自身；改为只选LISTEN进程。以上没有改弱产品安全边界。

边界：不推算工时、效率、Token/费用；当前状态不是状态变更历史。未测试Windows和第三方软件粘贴界面。体验模式 `EAS_KEEP_OPEN=1 node scripts/verify-timeline-receipt.mjs`，状态写 `/tmp/eas-timeline-receipt-instance.json`；只清理本脚本所属实例。
