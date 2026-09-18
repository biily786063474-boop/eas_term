# 全局时间线改造
用户批准全局热力图/跨项目拨轮/项目多选标签；插件热启停、所有受管对话适用，不占用当前绑定的 MCP 插件，不加模型调用。
分支 feat/global-timeline-20260918，基于当前 fdafd0f；主目录原有很多未提交改动，保留不夹带。未建额外 worktree、未提交、未更新正式应用和 ~/.eas/plugins 副本。
设计 docs/superpowers/specs/2026-09-18-global-timeline.md；执行计划 docs/superpowers/plans/2026-09-18-global-timeline.md；用户阅读版 docs/2026-09-18-global-timeline-implementation.html。
已开始：global.mjs 聚合、capture.mjs 摘录式候选、pluginEvents.ts 可撤销传输核心；先红后绿。尚未接入真实宿主事件、用户授权、候选持久化、全局 UI，不能说自动记录已开启。
下一步：Task3 的清单权限/用户开关配置与宿主接线，然后 Task4 服务/候选落盘、Task5 面板、Task6 真机验收。热力图计正式成果，候选另计；筛选≠关闭采集。
本机正式版0.4.101此前检查缺时间线集成；首次热插拔需宿主升级，不能只安装插件冒充全链路。任务完成时要确认发布 worktree 包含提交。

## 2026-09-18 本轮继续实现
已接通授权/全局查询/会话事件/候选持久化/真实 UI。详见更新后的计划，旧「尚未接线」为前一阶段历史。定向50通过；低并发全量2862通过13跳过0失败；typecheck/build通过；真实隔离应用21项通过并截图。自动链路用模拟完成事件验证真实宿主函数+落盘，没有运行付费模型。
仍未提交/合并/发布；未动正式app和~/.eas插件。下一步不是重复写全局 UI，而是完成卸载/插件文件更新替换时主动撤销/旧进程重握手、候选关联已有成果、三CLI真实轮次/Windows验证。当前插件开关可热切换，完整更新生命周期不能宣称完成。


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

## 本次提交快照最终结果
暂存内容独立导出验证：全量 2873 项，2859 通过、14 跳过、0 失败；定向 56 通过；typecheck/build、21项真实隔离UI、生命周期PID退出/新代码重握手/重装及真实应用重启恢复全部通过。数字不同于先前混合工作区，原因是排除了其他agent未提交代码。本地提交，不合并/推送/发布；Claude、OMP、Windows及跨轮关联的边界仍如上。

## 主线整合进度
用户授权审查/合并/推送。在 /tmp/eas-timeline-integrate 独立 worktree 将 a27acf7 cherry-pick 到 origin/main f711419，保留主线安全/运行时能力，原工作区未改。复审修复失败轮次恢复漏记和撤权后旧 RPC 落盘竞态（共享提交锁+epoch，SIGSTOP 实际 stdio 回归通过）。锁遗留需人工处理，不宣称自动恢复。最终验证/提交/远端状态以 commit-handoff 后续记录为准。
