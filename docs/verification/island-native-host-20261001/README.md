# 原生灵动岛 + Dock 修复：合入主线前验收（2026-10-01）

分支 feat/island-native-host-20261001，基于 origin/main 5500d6f6。前身是 2026-09-28 未提交的
refactor/island-native-host-20260928（/tmp/eas-island-dock-20260928，原样快照为 ac6db1c1）。

## 本轮做了什么
- 审批绑定请求身份（rev），解除 Lab 禁用岛内批准；超长审批降级回终端、不截断。
- Lab 设置页「检查更新」说明是实验版不接正式更新（中英）。
- 独立审查 2 条阻断 + 10 条次要，全部处理（见下）。

## 自动检查
- 第一轮 npm run check：4337 项，4318 通过 / 19 跳过 / 0 失败（审查修复前）。
- 第二轮见 check2.log（审查修复后）。
- 新增测试先红后绿：approvalRev 3 项、islandHostProtocol 绑定 3 项；Electron 崩溃自愈守卫测试在旧写法下红、修复后绿。

## 真机（隔离实例：临时 userData + 假 HOME + --use-mock-keychain，测试夹具通知，CGEvent 真点击）
- prod-dock/result.json：正式版默认路径（Electron 岛 + skipTransformProcessType）12 项 Dock 检查通过。
  观察项：dismissKeptForeground=false、taskClickFocused=false。
- 对照：同一脚本跑纯净 origin/main 构建，两项观察结果完全相同，且进程 activationPolicy=1（accessory，Dock 无图标）。
  → 这两个焦点问题是主线既有问题，不是本分支引入；Dock 参数只带来改善。
- native-dev/result.json：原生宿主路径（EAS_ISLAND_NATIVE=1 开发实例）8 项通过，含 dismiss 不抢前台、点任务回主窗口、外部全屏三项。
  修 I-2（bridge 缺 lang）之前，这一项在新主线上是失败的：面板永远不出现。

## 审查处理
- I-1 正式版回归：Electron 崩溃自愈被共用的节流时间戳拦下 → 拆成 nativeFailedAt/nativeFailures，测试钉住。
- I-2 原生页加载即抛错（主线新增 window.island.lang）→ bridge 补 lang/onLangChange，ready 时补发语言，切换语言单独转发。
- M-1 正式包忽略 EAS_ISLAND_NATIVE；连续失败 5 次停止重建；Lab 不再写该环境变量。
- M-2 子进程 HOME 仅在 Lab 隔离时改写。M-3 out/island-native-assets 排除出正式 asar。M-4 守卫 2.5s < 重建 3s。
- M-5 rev 覆盖范围在图纸里如实写明（中间没跑过一轮的原地换题仍未覆盖，既有缺口）。
- M-6 notice id→ptyId 统一 split(':')[0]。M-7 服务名走 i18n。M-8 Swift 先 isValidJSONObject。
- M-9 运行中心「停止」真的停；Lab 构建不再锁死旧分支名。（每次显示/隐藏都登记服务、刷新闲置代际：Lab 专属，未改。）
- M-10 Dock 测试锚定 createElectronIsland。

## 未验证（没有条件，不冒充通过）
多显示器 / 不同缩放 / 睡眠唤醒 / 拔屏、真实一小时闲置与 RSS、Claude/OMP 在线、macOS 12 / Intel 实机、Windows 实机
（Windows 路径代码只多了 HOME 条件与类型改动）、Developer ID 签名公证的 Lab 包。本轮未重新打 Lab .app。
