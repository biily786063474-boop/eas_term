# 灵动岛原生通知宿主设计（待评审）

## 目标

主应用 Dock 图标始终保留；通知出现、悬停、忽略不切换前台应用；只有用户点击任务才恢复正常主窗口并定位会话；切换途中通知不拦截主窗口。保留现有视觉和状态逻辑、macOS 12+ 支持，不修改 Windows 路径。正式应用本轮不替换。

## 为什么不是继续补一个窗口参数

Electron 42.11.8 的全屏可见配置默认调用 DockHide，是图标消失的直接原因。跳过转换可恢复 Dock，但空白 Electron panel（没有事件处理、没有关闭操作）在鼠标松开后仍激活其进程；旧 Accessory 配置同样如此。原生 NSPanel 对照未激活。证据：docs/diagnostics/island-native-click/result.json，脚本 scripts/probe-island-native-click.mjs。

因此点击抢焦点不是本次 Dock 参数新引入的业务逻辑错误，不采用“点击后切回原应用”的补偿方案。

## 多视角评估

| 方案 | 功能正确性 | 体验/成本 | 结论 |
| --- | --- | --- | --- |
| 仅跳过进程转换 | 保留 Dock，但点击抢焦点未解决 | 改动最少 | 不交付为完整修复 |
| 强行 dock.show 或切回旧应用 | 事后补偿，不是真正隔离 | 闪烁、键盘输入风险 | 否决 |
| 打补丁/自编 Electron | 可深入修原生窗口，需长期维护 fork | 构建和升级成本高 | 不首选 |
| 独立原生 NSPanel + WKWebView 宿主 | 原生窗口可明确非激活，主应用身份独立 | 多一个仅显示时运行的轻量进程；增加签名/打包链 | 推荐，集成前需完成剩余验证 |

不增加任何 LLM 调用或 token 消耗。真实内存/启动耗时在集成验收时实测，不预报虚构百分比。

## 结构与职责

1. Electron 主进程继续拥有状态、通知显隐判断、尺寸定位、偏好、Dock 菜单和任务路由。
2. macOS 宿主创建真正 NSPanel，初始化时包含 nonactivatingPanel；不可成为主窗口/键盘窗口，允许鼠标操作；全屏与多桌面行为实测。
3. WKWebView 复用现有 island HTML/React/CSS。通过只读本地资源协议提供打包资产，路径限制到专用资产清单，不允许任意 file 路径、导航、下载或外部网络。
4. Windows 仍走现有 BrowserWindow，不迁移主应用 WebContents，不改变 CLI/MCP/权限系统。

## 最小通信协议

使用父子进程 stdio，不开网络监听端口。版本握手和实例 generation 校验，过期实例动作拒绝。

- 主 → 子：init（受信资源根、父 PID、协议版本）、state、bounds、enter/leave/collapse、ignoreMouse、close。
- 子 → 主：ready、size、hold、action、diagnostic。
- action 仅允许既有 focus/dismiss/approve/mini/unmini；id 必须在当前状态中存在。审批继续进入既有权限逻辑，宿主无权自行批准命令。
- 严格验证类型、有限数字、枚举和消息大小；调试信息写 stderr，stdout 只输出协议；不传账号密钥、文件权限或 CLI 控制句柄。
- 不新增生产环境辅助功能/录屏权限。CGEvent 仅为本地验收驱动，不进入产品。

## 交互时序

### 展示 / 悬停 / 忽略
主进程推状态 → 宿主非激活显示 → hover/size 仅更新布局 → dismiss 回传静音动作。全流程禁止 app.activate、focus、主窗口 show。

### 点击任务
宿主先禁止鼠标命中并隐藏视觉 → 发送带实例标识的 focus → 主进程校验任务存在 → 既有 restore / activateAllWindows / focus / 会话定位执行 → 验证前台落定后收尾。过期任务提示失效，不跳转其他任务。激活失败在有限超时后恢复通知可操作性，不无限遮挡。

### 关闭 / 崩溃 / 空闲
父退出、stdin EOF、父 PID 失效均终止宿主；退出只处理所属子进程，不全局 kill。状态无内容时按现有退场时序关闭；窗口切换途中不销毁当前宿主，以免破坏前台切换。崩溃有限节流重启，旧实例不可回写。构建缺宿主必须阻止 macOS 发布，不静默退回已知抢焦点的旧路径。

## 必须通过的验收

- Dock / 原生 activationPolicy 在启动、通知、点击、销毁重建后正确。
- 真正独立 AppKit 前台应用中输入不被中断，hover、空白点击、dismiss、mini 不换前台 PID。
- 点击任务：最小化、隐藏、普通后台、其他应用原生全屏；会话定位正确，岛不挡主窗口点击。
- 单屏、多屏、不同缩放、刘海、Space 切换、睡眠唤醒与断开显示器。
- 宿主握手/超时/畸形消息/无效 id/旧实例消息/崩溃/父退出；无孤儿进程。
- WKWebView 现有视觉、动画、尺寸反馈与 Chromium 版本对照；本地资产断网可用，外部导航拒绝。
- arm64/x64 构建与签名、公证、macOS 12 兼容；Windows 回归无修改。

## 当前阶段

已完成原生空白面板对照。尚未开始生产宿主接线；该设计涉及新增原生组件，需先审阅此 spec，再写实施计划。此前单参数候选仍不可独立合入/发布。

## 2026-09-28 用户决定
用户要求专门架构分支，后期单独提供测试 App，并开始工作。已创建 refactor/island-native-host-20260928，独立测试 App 定名 Eas-Term Island Lab，独立 appId/userData，不覆盖正式软件、不接正式更新。实施计划见 docs/superpowers/plans/2026-09-28-island-native-host.md；生产接线前完成该计划审阅。
