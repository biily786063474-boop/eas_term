# 灵动岛原生宿主 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after plan review. 不并行改同一接线文件。

**Goal:** 在专用架构分支将 macOS 灵动岛迁移到非激活 NSPanel，并以不覆盖正式软件的独立测试 App 验收。

**Architecture:** 主进程保留状态和任务路由，以窄接口驱动宿主。macOS 使用 Swift NSPanel/WKWebView + stdio；Windows 保留 Electron BrowserWindow。先完成显示/忽略/跳转最小闭环，再扩展原有全部交互。

**Tech Stack:** Electron 42.11.8、TypeScript、Swift/AppKit/WebKit、现有 React/CSS；不新增出站服务。

**Spec:** docs/specs/2026-09-28-island-native-host.md（用户 2026-09-28 批准专用架构分支并要求独立测试 App）

## Global Constraints

- 分支 `refactor/island-native-host-20260928`；复用现有隔离工作树 `/private/tmp/eas-island-dock-20260928`，不在主要工作树实施。
- macOS 12+；不修改主进程 whenReady 注册顺序、fsGuard 和 IPC 主 frame 守卫。
- 不替换 `/Applications/Eas-Term.app`，不合入 main，不推正式更新源。
- 测试产品名 `Eas-Term Island Lab`，bundle id `com.biily.easterm.islandlab`；独立 userData / 日志 / 缓存，不复制真实账号凭证，不自动迁移正式数据。
- 本轮默认当前会话顺序实施；分支与实验包均不是正式发布。用户审阅本计划后开始生产代码接线。

## Review Focus

1. 已消失的任务或旧宿主晚到动作不得定位/批准新任务（任务 1、3）。
2. 审批正文不得截断；超限时要求回到主窗口，不呈现被截断的批准按钮（任务 1、4）。
3. 用户正在全屏输入时不能抢焦点；点击任务后旧窗口不得继续拦截（任务 2、3、5）。
4. 宿主启动失败、父进程异常退出、stdin 拆包不得遗留幽灵窗口（任务 1、2、5）。
5. 测试包不得通过单实例锁、更新、协议处理或数据迁移影响正式应用（任务 5）。

## 文件边界

- 新建 `src/main/islandHostProtocol.ts` / `.test.ts`：消息校验、版本/实例、长度上限、动作授权。
- 新建 `src/main/islandNativeHost.ts` / `.test.ts`：所属子进程、stdio、超时、关闭/退出、事件回调。
- 新建 `resources/island-native/Host.swift`：真正 NSPanel、WKWebView、受限资源协议、父生命周期。
- 新建 `resources/island-native/bridge.js`：仅提供与 src/preload/island.ts 相同的 window.island API。
- 新建 `scripts/build-island-helper.mjs`：arm64/x64 macOS 12 最低版本编译，产物校验。
- 修改 `src/main/island.ts`：窄宿主接口替代直接依赖，不改变任务激活算法；保留 Windows 工厂。
- 新建 `build/island-lab.cjs` / `scripts/build-island-lab.mjs`：独立打包配置和安全预检。
- 新建 `scripts/verify-island-native-host.mjs`：真实 App / 原生输入 / 生命周期验收。
- 同步图纸 03、10、13 和本次验收记录；修改涉及的图纸与代码一起交付。

## Task 1 — 窄协议与非法消息门禁

- [ ] 写失败测试并运行 `node --test src/main/islandHostProtocol.test.ts`：
```ts
assert.equal(decodeHostEvent('{"v":1,"generation":"old","type":"ready"}', 'current'), null)
assert.equal(decodeHostEvent('{"v":1,"generation":"current","type":"resize","w":null,"h":30}', 'current'), null)
assert.equal(decodeHostEvent('x'.repeat(262145), 'current'), null)
assert.equal(decodeHostEvent('{broken', 'current'), null)
```
- [ ] 实现 `decodeHostEvent(line: string, generation: string): HostEvent | null`，HostEvent 为 ready、resize（有限正数）、hold（boolean）、action（IslandAction）的判别联合。版本固定 1；UTF-8 每帧上限 256 KiB，缓冲超限立即关闭；未知类型拒绝。
- [ ] 实现 `allowHostAction(action: IslandAction, state: IslandState): boolean`：focus 限现存任务/通知的目标 id；dismiss 限现存通知 id；approve 必须是现存审批选项的整数 index、非 dangerous/stale，之后仍走既有审批链；mini/unmini 无目标权限。
- [ ] 增加分片/多帧/EOF/超长帧/NaN/未知动作/旧 generation/过期 target/审批正文超限测试；超限审批仅生成跳转主窗口的通知，不保留 approve。
- [ ] 测试变绿，记录 red/green 输出，评审序列化不携带密钥或其他 API 能力。

## Task 2 — 可单独运行的原生宿主

- [ ] 先写进程验收脚本：启动后发送 init，等待 ready；关闭 stdin 后等待进程退出；坏版本和越界资源请求必须拒绝。未有二进制时应失败。
- [ ] Swift 以 `NSPanel(...styleMask:[.borderless,.nonactivatingPanel]...)` 创建窗口，覆写 canBecomeKey/canBecomeMain 为 false；只用 orderFrontRegardless，不调用 NSApplication.activate。
- [ ] WKWebView 注入 bridge；JS 接口严格复制 onState/ready/hold/reportSize/onCollapse/onLeave/onEnter/action 的签名及退订语义。不暴露 eval、文件写入、shell、通用 IPC。
- [ ] 使用 WKURLSchemeHandler 仅服务构建清单里的 island HTML/JS/CSS/字体；标准化路径、拒绝 `..`、软链越界、外部导航和新窗口；CSP 禁网络与动态代码；WebKit 进程消失作为故障上报。
- [ ] stdin 后台读取，所有 UI 操作回主线程；EOF、父 PID 变化终止宿主。诊断写 stderr，stdout 只有版本化 JSON 行。
- [ ] 编译 arm64-apple-macos12 / x86_64-apple-macos12 并 lipo；缺编译器或产物不是成功，macOS 实验打包直接阻断。
- [ ] 验证真正 WKWebView 页面可点按钮且前台 PID 不变，截图检查原界面。原生空白样例成功不替代此验收。

## Task 3 — 最小业务闭环

- [ ] 对宿主适配器写 fake child 测试：ready 超时、启动失败、stdout 分片、重复 close、旧 generation、退出后晚到 action；用假时钟，不延长生产超时掩盖失败。
- [ ] 定义统一接口：
```ts
interface IslandHost {
  send(channel: 'state' | 'enter' | 'leave' | 'collapse', value?: IslandState): void
  setBounds(bounds: {x:number;y:number;width:number;height:number}): void
  setIgnoreMouseEvents(ignore: boolean): void
  showInactive(): void
  isDestroyed(): boolean
  destroy(): void
}
```
- [ ] 现有 Electron 窗口用 adapter 实现该接口；macOS 工厂返回原生宿主；主窗口排除逻辑继续兼容 Windows 的岛窗口。不得伪造 BrowserWindow 绕过 guardedOn。
- [ ] 将 ready/size/hold/action 的业务处理抽为本地函数，Electron guardedOn 和经过协议校验的原生宿主分别调用。绝不将子进程消息直接转发为任意 ipcMain 事件。
- [ ] 打通 state→显示、dismiss→静音、focus→穿透退场→既有主窗口激活→正确会话。保留 ENTER_MS 失败恢复和崩溃节流。
- [ ] 隔离真实 App 验证三个闭环；每项同时看 UI、前台 PID、动作日志和命中层消失。任一失败不扩展功能。

## Task 4 — 原有能力与安全回归

- [ ] 接齐 mini/unmini、hold、自动折叠、ready 首帧、resize/刘海、多条任务/通知、审批安全链。
- [ ] 对照现有 React CSS 的过渡动画与 LEAVE_MS=160；截图比较文字、圆角、缩放、透明区，不擅自换设计。
- [ ] 运行 `npm run check` 和 `npm run build`；原 islandVisibility / IPC guard 测试继续通过。增加不可见透明区不截获主窗口点击的原生用例。
- [ ] 故障测试：连续创建销毁、崩溃节流、挂起/恢复、父退出、宿主被杀、长审批、无效工具动作、过期会话；查看所属子进程无泄漏。

## Task 5 — 独立 App 交付门禁

- [ ] 写配置测试：productName / appId / userData / 更新禁用标志与正式版不同；阻止实验构建写正式 latest.json 或 updater feed。
- [ ] 新打包入口显式标记实验 branch + commit；输出 `release-island-lab/`，始终 `--publish never`。校验宿主、资源清单、签名嵌套关系。
- [ ] 单实例、协议注册、系统登录项、自动更新、默认数据迁移逐项检查；实验模式不注册正式协议，不读写正式 profile。
- [ ] 先出本机 arm64 独立 .app，验证与正式 App 同时运行互不影响；打开前确认 profile 和 app id。后续提供用户测试安装包，不通过正式版自动更新推送。
- [ ] arm64/x64 构建及签名校验；x64、macOS 12、Windows 实机没有条件时明确列“未验证”，不得称全平台通过。
- [ ] 真实全屏/Space/多显示器/缩放/睡眠恢复、聚焦任务、退出清理验证并记录证据。未通过项阻断合并，用户可先收到清楚标注范围的实验包。

## 执行与交付

计划审阅后建议当前会话顺序执行，接口关联紧，不拆成多个并行开发者。最终另做一次独立审查。用户未要求本轮提交或合并；后续提交按用户规则默认推对应远端分支，不推 main、不发正式版。

自检：spec 的通信/视觉/生命周期/安全/构建/独立测试要求均对应上述任务。最小闭环先于全量迁移，避免先铺基础设施却迟迟没有可测结果。

## 执行台账（2026-09-28）

- 用户已确认当前会话顺序实施。协议、原生宿主、真实开发 App 三闭环已落地并验证；见 docs/verification/island-native-host-20260928。
- Ruling: 保留一个窄结构化 window handle（webContents.send 仅兼容 state/enter/leave/collapse），不伪造 BrowserWindow/IPC sender — 降低改动面且保留原有生命周期边界。
- Ruling: 实验宿主暂时禁用直接 approve，仍可跳回终端审批 — 独立审查发现源协议没有稳定审批 revision，旧点击可能批准新请求。此安全门禁意味着 Task 4 全能力迁移尚未完成，不可作为正式替换发布。
- Ruling: Lab 隔离 HOME 之外，还强制 CODEX_HOME/DSH_HOME/CLAUDE_CONFIG_DIR/XDG/ZDOTDIR，清继承密钥和 shell 启动脚本变量，并跳过 login-shell 环境探测 — 防止启动读写正式配置。
- 原生资源采用 island 依赖闭包，固定无网络 CSP；宿主在 sharedServices 登记，真实 close 后释放。
- 第一次全量检查受到依赖由共享软链改成本地副本影响（typescript 短暂不存在），另外报告新启动原语缺清单及一项时序超时；均保留原日志。修复清单与完整依赖后，全量检查 3956 通过、18 跳过、0 失败；最后 Lab 环境加固需再跑。
- Lab 首次打包被 electron-builder 的外部依赖软链保护拒绝，未绕过保护，已物化独立 node_modules。OMP 下载未完成，停止本次下载，改用本机同版本缓存并通过原 SHA256 脚本验证。
- 原生宿主 arm64/x64 通用二进制已编译；当前 Lab .app 只构建本机 arm64，ad-hoc 签名，不是公证发行包。
