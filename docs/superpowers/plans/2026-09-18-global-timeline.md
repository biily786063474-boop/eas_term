# Global Timeline Implementation Plan

> 单会话执行，不派生子 agent。按 superpowers:executing-plans 逐项推进，未经用户另行要求不发布。

**Goal:** 本机全局热力图和项目筛选，时间线插件热启停并接收受管对话成果候选。
**Architecture:** 项目数据分存、可信登记项目聚合；通用授权事件总线驱动插件，本地规则产候选。显示筛选与采集授权分离。
**Tech Stack:** Electron / TypeScript 主进程、Node stdio MCP、零依赖 HTML/CSS 面板。
**Spec:** docs/superpowers/specs/2026-09-18-global-timeline.md

## Global Constraints
不修改他人未提交内容、不覆盖正式应用、不新增出站/模型费用、不扫描全盘、不改变 fsGuard / 启动顺序。先测试失败再实现。旧插件同名用户副本会覆盖内置，验收使用干净用户目录。自动识别只能产候选。

## Task 1：全局查询内核
文件 resources/plugins/timeline/lib/global.mjs + global.test.ts。
- [x] 先写跨项目/筛选/分页/相同 taskKey/坏库/非法项目/重复根测试并观察失败。
- [x] 实现只接收可信项目快照的聚合查询与复合身份详情，不接收任意用户 cwd。
- [x] 运行插件全部单测，记录结果。

## Task 2：零 token 候选判断内核
文件 resources/plugins/timeline/lib/capture.mjs + capture.test.ts。
- [x] 明确交付/否定/计划/失败/取消/已有回执/输入上限/来源身份测试先行。
- [x] 纯函数把可信完成事件转为 pending 候选，保留原文与来源，不生成证据。
- [x] 验证候选生成确定性，eventId 可用于后续幂等。

## Task 3：通用授权事件总线
文件 src/main/pluginEvents.ts + .test.ts、pluginManifest.ts、shared/types.ts、pluginHost.ts、agentChat/session.ts。
- [x] 定义清单订阅权限与用户授予/撤销、固定路径配置持久化；AI 不能自行授予。
- [ ] 接受宿主完成事件，开启/排除/卸载 generation 检查、有界队列、错误可见。
- [x] 把现有会话事件转换为最小摘要；不改变原对话插件绑定和 CLI MCP 集合。
- [ ] 验证已运行会话、跨项目、重复回调、开启后关闭再开启、进程更新与异常恢复。

## Task 4：插件接入与候选持久化
文件 timeline/server.mjs、plugin.json、lib/candidates.mjs + .test.ts；宿主授权项目快照来源。
- [x] tools/list 新增项目枚举与全局查询协议；兼容原 project-local 工具调用。
- [x] 候选独立文件、eventId 幂等、原子写、大小上限与路径守卫。
- [x] 成功回执去重，候选确认/忽略，确认失败不先删候选。
- [x] stdio 集成测试，旧宿主协议降级说明。

## Task 5：全局 UI
文件 timeline/ui/panel.html，沿用已批准视觉，不换设计系统。
- [x] 全局记录开关、项目排除设置、单独的项目多选标签。
- [x] 月热力图/日拨轮/详情同步筛选，项目标签与来源，候选单独计数。
- [ ] 无项目、无记录、部分读取错误、旧宿主不支持、关停状态明确。
- [x] 慢请求 generation 防跨筛选污染、支持 reduced motion。

## Task 6：验收与交付
- [x] typecheck + 全量测试（低并发）+ build。
- [ ] 扩展 scripts/verify-timeline.mjs：两个项目、已有非时间线会话开启后捕获、关闭后不写、跨项目筛选/热力图/候选确认/去重、用户排除、重启恢复。
- [x] 真实隔离应用亲眼验证保留截图；区分模拟事件、真实模型、Windows，未覆盖不冒充通过。
- [ ] 同步架构 10/11/12/13 与 release handoff；显式提交与合并后通知发布分支，不只装本机副本。

## 2026-09-18 首批进展
Task 1/2 完成纯函数内核；Task 3 已实现可撤销、有界串行队列与项目白名单的纯事件总线（未接入实际宿主授权/会话）。新旧定向测试共 23 项通过。面板/配置/候选落盘/真实自动记录仍待接线，当前不能宣称全局记录已可用。

## 2026-09-18 接线与隔离验收
- 宿主清单事件权限、固定 userData/plugin-event-grants.json、用户授权、项目排除、现有会话事件采集已接通。完成输出上限 4000 字，队列 64；取消/进程崩溃先抑制候选，已有正式回执不重复候选。
- 候选独立落盘、重复事件幂等、确认/忽略；坏库不覆盖、确认失败保留候选。候选返回最多 50 条与总数，确认后下一批可重新打开。
- UI 全局开关/项目多选/范围/候选数量；两项目聚合热力图、项目标签、跨项目详情已在真实隔离 Electron 打开验证，保留原粒子和动效。
- 定向 50 项通过；低并发全量 2875 项：2862 通过、13 跳过、0 失败（随后只新增 2 个候选安全测试，定向已覆盖）。最初高并发失败 8 项：3 项因新增函数未注入旧 VM 测试，已修正；其余 5 项在低并发复跑通过，不隐瞒首次失败。
- npm run typecheck、npm run build 通过；scripts/verify-global-timeline.mjs 通过，结果 docs/verification/global-timeline/result.json。原 verify-timeline 入口转向扩展验收。
- 自动采集主链路通过真实宿主函数 + 模拟完成事件 + 真实候选文件验证；UI/网关使用真实隔离应用。没有唤醒付费模型，不能称三 CLI 实际模型轮次已经验收。
- 尚未完成：插件卸载/文件更新替换时的主动订阅撤销与旧进程重握手；跨轮候选关联已有成果 UI；三 CLI 真实完成轮次与 Windows 验收；提交合并/正式发版。当前开启/关闭为热操作，不能扩大宣称完整更新生命周期已完成。


# 全局时间线验收：未通过

2026-09-18，在隔离 macOS Electron 实例执行，未替换正式应用。

## 通过
- typecheck、build、本轮 28 项定向测试、21 项隔离 UI 检查。
- Codex 真实既有非时间线会话：开启后完成极小计算任务，回复“已完成：17 + 25 = 42。”，自动新增 1 条候选。
- 真实退出、重启应用：全局开启状态、排除项目、成果历史恢复。

## 实测失败
- 修改插件 server.mjs 后，旧进程仍返回旧内容，未加载新代码。
- 移除插件后，已打开面板仍能调用旧进程。
- 根因：pluginHost.acquire 按名称复用缓存进程；panelRpc 使用缓存 Hosted，没有更新/卸载失效回收链路。需要统一撤销事件订阅、回收旧进程、面板失效和新版本重新握手。

## 环境阻断与未验证
- Claude 返回：Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access。不是有效模型交付，不算验收通过。
- OMP：隔离验收环境未配置模型服务商；未复制正式版凭证或修改用户账号。
- Windows 未验证。完整三 CLI 实机取消、正式回执去重矩阵未验证。

## 证据
- ../global-timeline-live/failure.json：保留 Codex 成功、Claude 阻断及首次断言中止记录。
- ../global-timeline-live-omp/result.json
- ../global-timeline-lifecycle/result.json
- ../global-timeline-restart/result.json
- result.json：21 项隔离 UI 检查。

本轮只验收并记录缺陷，没有修复上述生命周期问题，没有提交、合并或发布。

## 2026-09-18 生命周期缺陷修复与复验
- 两项实测缺陷已修复：插件文件更新立即使旧面板/旧shim失效，关闭所属旧进程；卸载后旧面板拒绝调用。重新打开握手读取新代码，重新安装可恢复，不重启宿主。现有面板显示进程退出，用户点击重试，不宣称无感替换UI。
- 统一 retirePlugin：撤销旧事件generation与队列、摘registry、撤销旧连接、关闭所属进程。旧onExit/onNotification校验Hosted对象身份，不误删/污染替代进程；安装根变更也撤销。
- 增加pluginLifecycle目录监听。复测首次发现macOS FSEvents会向新监听器重放重装前事件，导致重装进程立刻退出；先补测试复现1!=0，再用真实文件状态快照过滤旧通知，测试转绿。根软链解析到实际插件目录，不遍历子软链；目录不可读则拒绝建立进程监听。
- 验证：typecheck/build通过；低并发全量2879项，2866通过、13跳过、0失败。随后根软链/不可读目录防护再次通过3项定向、typecheck/build及真实生命周期复验。原21项UI检查、实际重启恢复均通过。
- verify-global-timeline-lifecycle：更新新代码、旧PID真正退出、旧退出回调不移除新进程、卸载拒绝及PID退出、重装重新握手通过；截图invalidated-panel.png已亲眼查看。最初CDP向销毁iframe求值超时属验收脚本问题，保留earlier-probe-failure.json，改从主窗口RPC校验失效会话，不掩盖失败。
- 仍未完成：Claude账号权限恢复后的真实模型验收、OMP隔离provider配置后的真实模型验收、Windows、跨轮候选关联已有成果。之前Codex真实自动采集通过，本轮未重复付费模型调用。未提交/合并/发布，未动正式应用。
