# 重连状态残留验收（2026-09-28）

基线 origin/main 92570390，隔离分支 fix/retry-status-recovery-20260928。

- 回归先红：text.delta 到达后 retry 仍为 {attempt:1,max:5}；修复后 reducer + Codex 翻译器 108 项通过。
- typecheck/build 通过。首次复用旧根目录 node_modules 失败（缺少 @modelcontextprotocol/sdk）；改用与本工作树 package-lock.json 相同的已安装依赖后通过，未修改锁文件。
- 隔离 Electron + 公共事件回放：retry→session.ready 仍重试→非空文字变为正在处理→第二次 retry 可显示→工具执行变为正在处理。before.png / after.png 已目视检查。
- 验证脚本 scripts/verify-retry-recovery.mjs 连接 renderer CDP 9457、main inspector 9458，必须由 EAS_VERIFY=1 独立 userData 实例提供；不发送真实模型请求。
- 启动日志有 MaxListenersExceededWarning（11 before-quit listeners），本次未修改或处理该生命周期告警。
- 未验证真实外网断线重连，未安装正式版。
