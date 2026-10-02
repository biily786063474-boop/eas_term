# Dock / 灵动岛焦点隔离方案（2026-09-28）

独立分支：`fix/island-dock-20260928`，基线 `1cbbc1c2`。不替换正式应用、不合并、不发布。

## 目标与边界

- 主应用始终保持普通应用身份，Dock 图标不因灵动岛出现而消失。
- 通知展示、hover、关闭通知不激活主应用，不抢键盘焦点。
- 只有点击任务才恢复并激活主窗口、定位对应会话，同时移除岛的交互层。
- 保留全屏/多桌面通知；不能用禁用通知或强制聚焦掩盖问题。

## 已确认根因

Electron 42.11.8 `NativeWindowMac::SetVisibleOnAllWorkspaces` 在 `visibleOnFullScreen=true` 且未指定 `skipTransformProcessType` 时直接执行 `DockHide()`。独立四组对照和安装版原生 activationPolicy=Accessory 均支持这一结论；不是 icns 丢失。
源码：https://github.com/electron/electron/blob/v42.11.8/shell/browser/native_window_mac.mm

## 方案评估

1. 首选最小修复：指定 `skipTransformProcessType:true`，不改全局进程身份，不在通知路径调用 focus/dock.show。
2. 不采用：每次通知后强行 dock.show / app.focus。可能激活应用，造成闪烁和焦点抢占。
3. 如果 Electron 普通应用中的 panel 无法满足真实点击不激活，需要进一步评估独立通知宿主；不能未经验证将一行参数视为完整修复。

## 实施与验收

1. 建立独立工作树与失败回归用例。
2. 最小参数修复，更新架构边界。
3. 构建真实隔离应用；独立原生 Swift AppKit 窗口作为前台，通过 CGEvent 点击真实按钮，不用 DOM click 冒充。
4. 验证初始 Dock、通知不激活、知道了不激活、点击任务正确定位、反复创建销毁以及原生全屏。
5. 全量检查与审查，记录失败和未验证项。

## 当前验收发现

Dock 和被动展示测试通过；真实点击“知道了”仍令宿主激活。独立原生前台助手也能复现，排除同 Electron bundle 测试偏差。正在区分已有行为与参数修改引入的行为。整项未完成，不可据此发版。

## 审查门禁

只读审查确认 dismiss 没有 JS focus 路径。最小参数候选不能单独合入/发布。
后续候选：macOS 独立原生 NSPanel 通知宿主；主应用保持 Regular，宿主不持有密钥、CLI、文件写权限，只返回白名单动作。dismiss 不激活；focus 先隐藏通知再由既有主进程定位任务。宿主跟随父进程退出，禁止全局清理。需要额外构建、签名、公证、arm64/x64 与全屏/多桌面验收；先做原生样例，不能直接重写生产架构。

本轮构建通过；全量 check 3964 项，3945 通过、19 跳过、0 失败；不等于实际交互通过。原始基线与 roundedCorners 追加对照均卡在 CDP Runtime.evaluate 初始化，未形成结论。未放宽超时或断言。
