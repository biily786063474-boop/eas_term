
## 2026-09-13 · 手动停止跨应用重启持久化（真机验收）

- runtime/stateStore + persistentState：固定 userData/runtime-state.json，fsGuard.guardRuntimeStateFile 不接收外部路径、不扩大通用文件 IPC 白名单；拒绝符号链接。0600 临时文件、fsync、rename；坏文件失败关闭，不静默清空停止意图。
- manualStop 延迟加载；停止/恢复先持久化成功再改变内存。stopHost 最终归属复核后、drain 之前同步保存；保存失败不会误关闭或留下 drain。plugin:panelOpen 将持久化错误返回可见 error，不留加载悬挂。
- 真机隔离开发实例主 PID 79069 -> 80355，测试服务重启前关闭后无 PID；应用重启后节点显示「服务已由用户关闭；请在插件面板点击重试并确认重新启动」，未自行拉起。点击重试弹原生确认；确认后服务 PID 80629、面板正文恢复、停止名单清空。关闭测试节点后正常 idle 回收，已核对无残留；临时插件移回 docs fixtures，不进入打包。
- 项目显示名「历史 UI 验收（p-verify）」和插件显示名已在真实关闭弹窗复核。
- typecheck/build 通过；定向 94/94。全量首次 3010：2995 通过、2 失败、13 跳过（codexCapabilityLauncher 配置探测等待5秒未观察到PID）；单文件重跑6/6，全量重跑2997通过、0失败、13跳过。保留原失败日志，不将重跑通过称为根因修复。
- 证据：docs/verification/runtime-governor/acceptance/persistence/。没有提交或发版。
- **完整资源治理仍未完成**：manager/driver 没有生产 bootstrap/工具入口接线；80/50 自动限流未启用，设置页诚实显示仅监测。AI/PTY/其他后台服务未统一接管；mac 内存估计未校准，Windows/Linux 未真机验证。不得用94个单测或服务停止验收冒充全软件资源上限验收。
- 下一实现必须处理 MCP request 超时只是调用方放弃等待、并不等于插件停止计算；否则将 run promise reject 当作释放预算会超发。需要独立实际完成/退出生命周期，再接首个真实 tools/call 切片，不能直接包整个 agent 生命周期。
