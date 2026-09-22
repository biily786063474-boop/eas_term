# 0.4.105 发布验收

- 源码 ade2fe5；插件市场卡片固定 96px，标题、简介、状态槽对齐，详情浮层不挤动布局。
- npm run check：3498 通过、18 跳过、0 失败；生产依赖审计 0 漏洞。
- Mac ARM/Intel 签名、公证、staple、Gatekeeper、ZIP/DMG 与应用哈希核验通过。
- ARM 正式包真实 UI 验证卡片等高、详情；Intel 在 Rosetta 下验证市场和原生 PTY，并非实体 Intel 验收。截图随附。
- Windows CI 35732994971 全流程成功。
- 正式用户应用未替换；隔离候选实例已退出。
- 外部 Computer Use 指针生命周期仍为已知问题；不宣称全部 32 项插件完成真实账号验收。

发布状态以 live-verified.json 和 github-published.json 为准。
