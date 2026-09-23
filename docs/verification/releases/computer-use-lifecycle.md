# Computer Use 指针残留：软件级发布验收项

记录日期：2026-09-07。状态：**未解决；本机临时清理已验证，不等于产品修复。**

用户要求：分发后不能让用户承担任务结束后清理指针的工作。必须由软件自动处理，不能只依赖 agent 记住收尾。

## 已有证据

- 用户截图显示两个发光箭头在任务结束后继续停留。
- `cua_repl.js_reset` 重置本次会话后，用户确认仍然存在。
- 精确核对可执行文件身份后，对 `SkyComputerUseService` 发送 SIGTERM；检查相关服务/客户端进程均已结束，用户确认箭头消失。
- 因此已定位到外部 Codex Computer Use 服务生命周期；具体哪个会话/窗口未释放尚未定位，不能断言根因代码已查明。
- 当前 Eas-Term 的 `resources/plugins/computer/server.mjs` 与 `native/windows.swift` 操作系统鼠标，不绘制这种叠加箭头。外部服务不是当前仓库的实现，也没有在本项目中找到会话级隐藏/释放接口。
- 当前 unified-computer-use 暴露的 reset 只保证重置 JS 绑定，不保证退出原生服务或隐藏指针。

## 产品实现边界

1. 不得把 pkill/killall 或退出全局 SkyComputerUseService 写入 turn.done、取消或 app 退出钩子；它可能属于其他应用或并行任务。
2. 接入自动清理前必须建立本软件拥有的 session/lease 身份，并取得官方支持的会话级释放接口；若改用自有指针层，则由自有宿主管理完整生命周期。
3. 完成、取消、失败、超时、会话/窗口销毁、软件正常退出均触发幂等释放；异常崩溃需服务端租约到期回收。迟到事件不能重新显示已结束任务的指针。
4. 多任务共用服务时只释放当前任务，最后一个本软件租约退出也不能误杀外部应用会话。不得硬编码本机路径、PID 或修改用户插件缓存来冒充随包修复。
5. 若上游无可靠接口，保持该问题开放并明确相关能力的发布限制，不得在发布记录中标成已修复。本文是人工发布验收要求，尚未实现自动构建拦截。

## 分发验收（全部待验证）

- [ ] Codex / Claude / omp 分别核实实际使用的 Computer Use 后端及其所有权；不适用项需记录证据。
- [ ] 完成、取消、工具失败、超时后，在约定回收时限内指针消失。
- [ ] 关闭对话/窗口、退出软件、强制结束本软件后，无持久残留。
- [ ] 同时运行两个任务：结束其中一个，不影响另一个；全部结束后无残留。
- [ ] 外部应用正在 Computer Use 时，Eas-Term 的清理不影响它。
- [ ] 清理后再次调用可以正常恢复，迟到响应与重复清理不会闪回指针或报错。
- [ ] 用实际分发安装包、干净用户环境执行上述检查；记录平台、架构、后端版本和前后截图，不能只验开发机或 JS mock。

下一步：取得外部服务会话级释放契约/上游修复，或设计可隔离的自有控制会话；先复现并写失败验证，再接软件生命周期。此前不宣称分发后已杜绝此问题。

## 2026-09-22 收尾核查（0.4.105 之后，仍未解决）

本次证据：`../computer-use/2026-09-22/audit.json`。

### 新发现：不能继续断言「上游完全没有收尾机制」

本机 unified-computer-use **26.903.61454** 的官方 manifest 声明了 Stop / Interrupt / SubagentStop → `cua_repl.turn_ended`，传 `session_id` 和 `turn_id`。旧 SkyComputerUseClient 的 `turn-ended --help` 也存在，用户配置已有 legacy notify；因此不能用「补一条 notify」解释或修复本次问题。

但以下事实仍阻止产品层安全接入：

- 当前公开 CUA 工具只提供 js / js_reset，getState 返回的公开 API 没有原生会话释放/隐藏指针接口。manifest 的内部 MCP hook 不能当作当前可调用工具。
- 当前 @oai/sky 0.6.26 的 service.js RPC 分支仅 setup / execute / Linux drag_start/move/end；没有可从此层确认的 turn_ended 原生释放处理。**这不证明 native 或 node_repl 内部绝无处理**，只说明不能从现有接口证明已串通。
- legacy `turn-ended` 的 help 未定义 payload 格式、会话所有权、返回/幂等/超时语义；不能猜 payload 向正在使用的全局服务发送，也不能把发送成功当指针已消失。
- 当前原生服务父进程为 ChatGPT，另外存在不同 Codex 客户端。PPID 只能说明进程树，不足以证明某个叠加指针对应 Eas-Term 哪个 session/turn，不能据此杀服务。
- Eas-Term 自带 computer 插件与外部 CUA 是不同后端。只改自带插件，不会修掉外部叠加指针。Claude strict MCP 配置/OMP 的后端还需独立真实验收，不能从 Codex 推断三家全覆盖。

### 本次没有做的危险捷径

没有 kill/pkill 外部服务，没有改用户 config 或官方插件缓存，没有向真实会话伪造 Stop/Interrupt，没有把任意本机 PID/路径写入产品，没有新增「保证自动清理」假钩子。没有完成新的残留前后视觉复现，历史残留证据保持原结论，验收框不勾选。

### 明确下一步门槛

取得官方可支持的 native session-scoped end/lease 契约，核实 manifest → node_repl → sky/native 的真实路由，再用隔离会话复现 Stop/Interrupt/崩溃及两个并发客户端，最终接入 Eas-Term 生命周期。若上游仍不提供，需要另立「自有 Computer Use 会话后端」方案；新增自有后端只能保证自有会话，不会自动清除外部服务已存在的指针。不可把另造一个本地指针层当成修复外部服务。
