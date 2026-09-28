# 0.4.115 发布前 Jev 旧包兼容修复
独立审查确认新版宿主对市场0.1.2误发host/restore致关闭，且新projectIds检查使旧时间线增强静默失效。jevProtocol按有效capability分流，旧版沿用显式验证及进程态授权，v2恢复/出站确认/项目范围不变。PluginInfo/parseManifest保留经过parsePluginRequirements校验的声明，只作协议标识，不授予权限；市场安装仍独立校验原始requirements。

- RED：新protocol测试失败；GREEN专项通过。实际v2初跑材料调用超时，定位到parseManifest未传递requirements；新增真实清单解析RED/GREEN覆盖后，build/check3970通过19跳过0失败。
- 实际Electron旧0.1.2隔离副本12项通过：验证、重开不自动请求、再次显式连接、能力开启、时间线事件建议回写仍待复核，两个已选能力各一次请求。
- 实际Electron v2 21项通过：判断、用量、窄屏、重启恢复、暂停保持、面板关闭后事件增强、锁柜撤销、退出清除。已亲眼检查旧版重连和v2暂停恢复截图。
- 独立复审通过，manifest/compatibility/protocol28项独立通过。无真实账号/网络付费调用，均隔离HOME/userData与假服务传输。
- 失败记录v2/historical-ui-harness-failure.json保留；旧测试脚本生成初次字符串定位失败，修脚本后通过，不涉及产品绕过。既有MaxListenersExceededWarning未修复。
- Jev0.2.0独立市场尚未发布；主程序升级不会覆盖用户插件。Computer Use及真实在线/Windows现场仍未验。
