# 右侧抽屉插件 popup 验收 · 2026-09-24

隔离分支 `feat/plugin-drawer-popup-20260923`，合并验收在 `integrate/plugin-drawer-popup-20260924`；临时 HOME/userData + OS 沙箱，未读真实密钥。`scripts/verify-plugin-drawer-popup.mjs` 在实际 Electron 应用中安装临时 Jev 包、从抽屉打开看板面板并取屏。

通过：卡片内容与留白打开面板，真实沙箱 iframe/宿主会话，主进程拒绝 popup 的 `eas/canvas.call`；关闭按钮、Esc、遮罩均关闭，其中关闭按钮验证 panel session 不再接受 RPC；审查补测插件关闭时 popup 及会话同步失效，并复查打开过程中插件状态变化；窄屏亮色无横向溢出。Jev 缺密钥安装后立即打开安全配置，密码不回显；取消不启动面板，再点卡片仍先打开配置。完整市场安装同样加必填密钥检查，原 Jev 市场回归脚本覆盖。

截图：`popup.png` 暗色面板，`popup-narrow-light.png` 亮色窄屏，`required-key.png` Jev 首次配置。`result.json` 是隔离脚本检查清单。

未验证：真实 TypeSafe 在线密钥和可能收费的连接验证（明确不自动执行）、保存密钥后自动转到面板的真实端到端操作（原生保存确认需真实交互）、物理 Windows、其他插件的多面板切换 UI。未推送、发布或替换正式应用。
