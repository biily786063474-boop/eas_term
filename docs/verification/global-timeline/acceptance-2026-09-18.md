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
