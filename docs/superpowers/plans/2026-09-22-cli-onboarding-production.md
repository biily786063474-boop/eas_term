# CLI 安装与登录完整流程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 实施单会话执行；最终按 requesting-code-review 做一次只读独立评审。

**Goal:** 把已确认 Demo 落进 Eas-Term：跳过后可重入，状态可靠，错误可理解与恢复，最小化后继续并提醒，独立前景贪吃蛇。
**Architecture:** 主进程拥有安装进程和唯一槽位；渲染层读取可恢复快照，复用 CliSetupPanel / CliLoginPanel，不另建安装器。
**Tech Stack:** Electron / React / TypeScript / Node test，零新增运行依赖。
**Spec:** docs/prototype/2026-09-22-cli-onboarding-demo.html。

## Global Constraints
- 在已有隔离工作区 .worktrees/plugin-update-release（main 同源 3546c13）实施；不改其中 Computer Use 待验收工作，不污染主目录。
- 不修改安装命令白名单、安全守卫、进程登记和启动注册顺序；不新增出站服务。
- 真实安装只由用户点击触发，不自动登录、不自动发草稿、不自动发版。
- 复用软件 base.css 的 surface / text / accent / radius / pop spacing / shadow。
- 单安装槽位保留；同 CLI 重入复用，不同 CLI 明示已有任务，不可取消别人任务。
- 验证仅隔离 userData 与模拟安装 IPC，不操作真实凭证；跨平台真实安装未做则明确未验证。

## Review Focus
1. 最小化或卸载后结果到达，重入不重复安装、不丢结果。
2. 信号退出和旧版仍存在不等于本次安装成功。
3. IPC 拒绝、探测异常、安静等待不能无限转圈或误诊网络。
4. 取消只在确认退出后结束；旧回调不得覆盖新任务。
5. 游戏状态不得遮住结果，焦点/Esc/计时器必须清理。

## Task 1 — 安装结果与失败分类
- [x] installOut.test.ts：信号退出失败断言，先跑红再修。
- [x] shared/cliInstallFeedback.ts 与测试：网络、权限、空间、超时、缺失、未知错误中文说明/恢复建议，不承诺重试成功。
- [x] main/cliAuth/install.ts：时间、快照、脱敏输出、Promise catch；同步 types.ts / preload。
- [x] 定向 node tests / 类型检查。

## Task 2 — 任务重入、最小化与取消
- [x] CliSetupPanel 先查快照再决定启动，重入不重复运行。
- [x] 最小化状态卡、结果自动展开、真实 elapsed 与安静等待提示、IPC 失败反馈。
- [x] 取消显示停止中并等待退出；所有权与竞态测试。
- [x] 卸载重入/渲染刷新仍可恢复主进程结果。

## Task 3 — 固定入口与草稿
- [x] 核对 AgentChatView 未安装模型可见，复用 StartupSetupCard 与发送闸门。
- [x] SettingsPanel 增加 AI 助手安装管理，复用 installPlan 与 CliSetupPanel。
- [x] AgentOnboarding 跳过仅影响首次展示，固定入口始终可用。
- [x] 草稿保留、完成不自动发送；未安装/安装中/失败/待登录/就绪真实显示。

## Task 4 — 独立贪吃蛇
- [x] 游戏纯状态机与方向、碰撞、暂停、重开测试。
- [x] 开始/暂停/继续/再来一局单按钮，入口与最小化同级。
- [x] 前景 portal、焦点陷阱、Esc、结果自动收起、计时器清理；全部用软件 token。

## Task 5 — 验收与交付
- [x] 类型检查、定向测试、构建。
- [x] 隔离应用真实构建 + 模拟 IPC 验入口、最小化、结果、游戏与明暗并截图。
- [x] 更新 architecture/10 与 03 对应图纸。
- [x] 列已验证/未验证；不自动 commit、合并、push、发版。

## 实施裁定与审查记录
- 2026-09-22：复用已有隔离工作区，不创建/合并其他分支；Computer Use 脏改动不归本任务。
- 最终只读评审指出跨窗口/代次取消、stopping 无重试、查看状态误登录、第二入口残留、历史成功覆盖卸载后状态五点，均补修并加测试。
- 单槽位沿用主程序既有约束，不扩为并发安装；不同 CLI 明示当前任务。
- 安装完成停在明确的登录按钮，不自动启动账号授权。


## 验收结果
- npm run typecheck：通过。
- npm run build：通过。
- npm test：3532 项，3514 通过，18 跳过，0 失败。
- 真实生产 React 组件构建到隔离 Electron，安装 IPC 完全模拟：首次安装、发起节点卸载、最小化重入、小游戏暂停/Esc/结果自动收起、失败中文提示、重试、显式登录、第二入口再次打开、历史成功后卸载重装、草稿保留均通过。
- 完整构建应用以 verify-app 独立 userData 启动，设置 → AI 对话 → AI 助手入口已打开截图。只读检测现有 CLI，不执行安装或登录。
- 截图环境开启 prefers-reduced-motion，避免已有后台动画暂停把设置遮罩停在 opacity:0。该已有后台动效问题不在本任务内，未改源码绕过。
- 启动脚本首次有 Electron 导入错误，已修正；fixture 首次缓存目录/CSP 警告已在验收脚本补齐。首次全量测试启动点清单有 1 项失败，登记 Windows 定向停止辅助进程后重跑通过。
- 未验证：全新 macOS / Windows 真实下载与安装、网络/权限/磁盘真实故障、真实账号浏览器授权、Windows taskkill 与真实多窗口并发。
- 代码未提交、未合并、未推送、未发布；原型和真实组件验收都不等于真实安装全平台验收。
