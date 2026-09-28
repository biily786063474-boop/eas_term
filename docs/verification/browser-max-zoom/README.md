# 浏览器最大化比例入口修复 · 2026-09-28

## 根因与边界
- `.canvas-zoombar.on-max` 自 e72acde2 起刻意隐藏画布工具栏，避免从玻璃模块后透出遮挡输入框；其按钮原本控制画布，不是网页。
- WebView 有 zoom → setZoomFactor 与最大化快捷键/捏合路径，但没有专用可见比例按钮。
- 最小修复：最大化浏览器地址栏右侧增加 − / 百分比 / ＋。Frame和自由节点共用WebView；同一maxScale、0.5–3范围，不动全局画布隐藏规则或浏览器安全配置。
- dom-ready用最新zoomRef补应用比例，避免网页刷新/懒挂载丢失。

## 验证
- webZoom.test.ts：先红1/绿1（缺少「缩小网页」按钮），修后2/2通过；验证动作值、上下限禁用、非最大化不显示。
- 真实Electron脚本7项通过，见result.json。坐标点击放大/缩小/复位，读取实际guest zoomFactor；刷新保留115%，退出归1并还原画布条，画布0.8不变，自由节点同样生效。
- 已亲眼检查截图maximized-115.png、free-node-115.png。maximized-87.png、restored-canvas.png一并保留。
- 构建/全量check结果见checks.json。无在线模型调用，不涉及发版。
- 已有日志告警：MaxListenersExceededWarning（before-quit 11监听器），不属于本次比例控件修改，未在本轮扩展修复。
