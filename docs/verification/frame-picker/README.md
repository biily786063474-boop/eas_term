# Frame 插入菜单验证 · 2026-09-17

- `npm run check`：退出 0；2837 通过、13 跳过、0 失败。
- `npm run build`：退出 0。
- `node scripts/verify-frame-picker.mjs`：10 项交互断言通过，真实隔离 Electron 截图已检查。
- 覆盖：3D 五种格式在文件夹/最近中的筛选、目录保留、插件入口搬迁、时间线面板创建、文件视图关闭重开与 renderer 重载偏好保存。
- 3D 仅筛选，不做模型渲染；最近仍从原有 60 项中筛选。未发版、未替换 /Applications 中应用。

验证过程：首次 typecheck 因新测试的动态 import 兜底 `{}` 产生 TS2339，去除测试兜底后全量 check 通过。追加面板创建验收时，重载用例曾因测试 Frame 未落盘而超时（当时 view=canvas、frames=[]）；测试现通过已有 canvas.save IPC 固定临时空 Frame fixture 再重载，不修改生产保存逻辑。原失败记录保留为 earlier-fixture-reload-timeout.json。重跑最终结果见 result.json。
