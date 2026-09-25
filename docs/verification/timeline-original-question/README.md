# 时间轴原始问题与插件鼠标边界验收 · 2026-09-24

- 隔离 Electron 实例使用临时 userData 与临时项目，未读取或改写用户正式时间轴；测试后清理。
- 通过真实插件网关调用 `timeline_record` 写入带 `originalQuestion` 的成果，面板详情在完成摘要前展示原话；候选列表显示原话、确认后持久化。旧记录字段缺失时兼容读取。
- 画布插件未选中时 iframe `pointer-events:none`，CDP 真实鼠标单击面板正文保持画板原生选中行为，空格拖拽仍平移画板，wheel 落在面板区域也平移画板；选中后普通插件点击可用，按住 Ctrl 后真实 Ctrl+wheel 在面板区域缩放画板；插件 iframe 获得键盘焦点时也经宿主注入的修饰键桥维持 Ctrl+wheel；CDP 真实捏合手势在选中插件上方同样缩放画板。
- `npm run check`：3689 项，3670 通过、19 跳过、0 失败。`npm run build`：通过。`git diff --check`：通过。
- 隔离脚本 `scripts/verify-global-timeline.mjs` 完整通过；验收脚本在开发中曾有一次面板自动刷新等待超时，后续完整重跑通过；该非确定性现象保留记录。
- 截图：`detail.png`、`candidates.png`，均为隔离夹具，无用户真实数据。

发布边界：时间线插件清单与 MCP server identity 已升到 `1.0.2`，避免新包覆盖旧版 `1.0.1` 的 immutable 包。这里只完成源码/隔离实例验收，**未发布远端插件市场，也未替换用户已安装副本**；正式生效需另走插件打包、目录发布与更新验收。
