# 原生灵动岛：独立实验版验收 2026-09-28

分支 refactor/island-native-host-20260928；基线 1cbbc1c277f96bb4f4c0ec873c6aed8d94083ce8，加本次未提交修改。不是正式发布。

## 已验证
- 全量检查：3975 项，3957 通过、18 跳过、0 失败。
- 实际打包 App 的 9 项验收见 packaged/result.json：Dock、通知不激活、忽略不抢焦点、任务跳回正确会话及退出命中层、外部原生全屏三条交互、关闭通知窗口、身份/配置/更新隔离。
- 使用独立原生前台 App 和真实 CGEvent 鼠标点击；业务通知来自测试夹具，不冒充在线模型调用。
- 原生宿主真实进程：页面 ready / 管道 EOF 清理，错误版本、超限帧、半帧 EOF、正常 EOF 通过。
- 本地 ad-hoc 深度签名验证通过；helper 包含 arm64/x86_64，主 App 为 arm64。

## 安全范围与未完成
- 岛内直接批准在实验版禁用：现有终端审批协议缺少可靠请求版本绑定，避免旧点击批准新请求。通过通知返回终端确认。
- 多屏、Mission Control 手动切换、休眠与拔屏、macOS 12/x64 实机及 Windows 未验收。
- 未做 Developer ID 公证或公开分发，不具备正式发布结论。
- 初次构建的依赖软链接拒绝、早期检查/脚本失败均已定位修正；不是一次全绿。执行记录见实施计划。

## 实验应用
`/private/tmp/eas-island-dock-20260928/release-island-lab/mac-arm64/Eas-Term Island Lab.app`

独立 bundle id / 用户数据 / CLI HOME / sessionData；关闭正式更新，不覆盖 /Applications/Eas-Term.app。

截图补充：task-focused.png 显示隔离账户首次引导覆盖层；会话路由由实际 activeTabId 断言验证，并非该截图直接展示了会话内容。尚未登录在线模型。

## 04:30 实机补验与修复
- 已登录 Lab 两个独立 Codex 会话真实返回 ALPHA / BRAVO，原生通知显示2条；点击BRAVO后跳到第二模块、计数1；再点ALPHA回到第一模块、计数清空。不是注入状态，不代表Claude/OMP在线通过。
- 实际发现原生宿主被终止后没有自动恢复：onError仅记节流时间、onClose仅清引用，后台无后续renderer事件。新增 islandRecovery 单次3秒重算，destroyIsland取消；保留显示判据与主进程安全边界。
- 修复包正常读取原Lab账号/历史，无复制凭证、未覆盖安装包。真实任务返回RECOVERED；精准SIGKILL本实例通知子进程11172后，3.27秒重建为12369（主进程8273），实际面板仍显示RECOVERED，点击返回该模块。
- 首轮check两个失败：POSIX Ctrl-C夹具、native package启动校验超时；不放宽测试时限。package专项2通过，最终完整check共3982，3964通过、18跳过、0失败。失败和复跑日志均在recovery/。
- 此轮覆盖后台通知/展开/任务跳回及真实故障恢复；不把有限次数切换当成长时焦点压力测试，也不声称其他平台/多显示器/休眠已验证。
