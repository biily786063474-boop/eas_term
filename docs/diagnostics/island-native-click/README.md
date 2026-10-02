# 原生空白点击对照（2026-09-28）

运行：在独立工作树执行 `node scripts/probe-island-native-click.mjs`（macOS，swiftc，已授权本地测试鼠标事件）。仅创建自己的临时窗口与子进程，finally 关闭所属进程，不启动模型。不是生产实现，不加入常规 CI。

## 结果

| 窗口 | 鼠标松开后仍保持外部应用前台 | 当前屏幕可见 |
| --- | --- | --- |
| Electron Regular panel / 跳过转换 | 否 | 是 |
| Electron Accessory panel / 原配置 | 否 | 是 |
| Electron Regular panel / roundedCorners | 否 | 是 |
| 真正 NSPanel / 普通桌面 | 是 | 是 |
| 真正 NSPanel / 外部原生全屏 | 是 | 是 |

`result.json` 保存各阶段 PID 和 on-screen window PID，`native-fullscreen.png` 已人工查看：蓝色测试面板浮在全屏原生助手之上。该测试只证明空白原生窗口能力，不证明正式灵动岛/WKWebView通信或任务跳转已经接通。

## 避免假证据

- 前台助手必须打成独立 .app，带独立 bundle id。裸 Swift 可执行文件的激活不稳定，不能代替这个验证。
- 点击器预编译，不能每个鼠标阶段临时运行 swift 解释器。
- NSWorkspace 属性必须让 RunLoop 处理更新再读取；单纯 usleep 可能读到缓存的前台 PID。
- 点击前前台必须确实是助手，否则直接中止；避免外部焦点变化污染结果。
- `dock` 字段是窗口创建记录（原生样例为声明配置），不是原生 Dock 可见性的独立最终验收。正式应用此前 Dock 候选验证与此区别记录。

结论：点击激活在无业务代码的 Electron panel 中也复现，原配置同样失败，不是 dismiss→focus 误发。应评估真正 NSPanel 宿主，不再在业务层补焦点切回。
