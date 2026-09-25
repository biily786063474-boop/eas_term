# 插件更新时自动停止运行中的插件 · 隔离验收

- 根因：`pluginMarket.installCommit` 同步调用 `assertPluginPackageIdle`，活跃宿主直接变成报错，UI 只提示用户自己去关闭。
- 本轮改为主工作台原生确认框；确认后仅目标插件走宿主 lease 复核、drain、停止并等待真实进程退出，再原子替换包。取消不写入，变更过程阻止同名插件重启；卸载同路由。
- `npm run check`：3670 通过、19 跳过、0 失败；`npm run build` 通过。
- `scripts/verify-plugin-hot-update.mjs` 使用独立 HOME/userData、受控市场服务与真实 Electron 进程：安装 v1.0.0 → 打开真实 MCP 插件进程 → 从市场更新 v1.1.0 → 拦截并检查原生确认框选项，自动同意 → 旧进程退出后更新成功；不接触用户安装版。`result.json` 和 `updated.png` 为证据。原生弹窗由测试启动适配器记录选项并代为同意，**未人工截取系统弹窗画面**。
- 生产插件市场已发布的 1.0.2 不包含这项宿主代码；需主程序新版分发。未改正式用户插件进程。
