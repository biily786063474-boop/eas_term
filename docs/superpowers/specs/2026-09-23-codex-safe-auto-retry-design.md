# Codex 原生路由超时的安全自动恢复（设计）

> 2026-09-23 23:04 用户批准参数修订：原始轮之外最多 **5** 次分叉恢复（原始轮 + 5 次 = 最多 6 次付费提交）；进度 1/5～5/5；首次退避 5 秒，其余各 20 秒。下文「2 次」是最初获批版本的历史设计记录，以上修订为当前实现上限。精确错误、ACK 确认、无活动、只读健康探测、分叉和失败关闭条件不变。

日期：2026-09-23  ·  状态：待用户审阅  ·  基线：`origin/main` `19569b42`

## 目标与已确认边界

用户希望 Codex 偶发原生失败时，不必频繁手动重发。默认允许在**严格可判定的工作区路由超时**后，原始尝试之外最多再自动尝试 **2 次**。不修改 Clash、代理规则或官方 CLI；不主动登出、清理或改写 Codex 凭证（Codex 自身的正常刷新仍按原生行为）。这里的“工作区路由”是 ChatGPT 帐户的服务路由，不是本地项目路径。

现场依据：2026-09-23 19:01–19:05 PDT，受管 Codex 0.156.1 的原生轮次运行约 218 秒，Codex 自身多次重试，最终 `turn/completed` 为 failed，错误为 `workspace routing discovery timed out`。同项目、同模型的前后轮成功；Eas-Term 未主动 kill。当前 Eas-Term 将其脱敏为 `unknown`，显示笼统失败。自动恢复是**新增容错功能**，不是修复已证实的软件主动截断。

## 方案对比与选择

1. **盲目重发 `turn/start`：拒绝。** 原轮可能已执行工具、写文件或只丢失确认；重发可能产生重复副作用与费用。现有“丢失 `turn/start` ACK 不重发”护栏保持不变。
2. **自动 `thread/revert` 后重发：拒绝。** 会改写用户原生历史，若判断错了难以恢复。
3. **保留失败线程，`thread/fork` 到失败轮之前，再发送原请求：采用。** 当前 Codex 0.156.1 的协议 schema 支持 `thread/fork.beforeTurnId`，其语义明确为排除该轮及后续轮次。旧线程保留作审计，新线程继承此前历史；Eas-Term 的一个可见会话继续指向新线程。若当前 CLI 不支持该参数，停止自动恢复，不退化为盲发。

## 严格资格判定

只有以下条件**全部满足**，才可进入自动恢复：

- 从原生 `turn/completed` 收到明确 `failed`，且错误文本**精确匹配** `workspace routing discovery timed out`；原生 `error` 通知、通道关闭、RPC 超时、ACK 不明、用户取消均不够资格。
- 本轮有确定的 thread ID 与 failed turn ID；可证明该轮没有 assistant 文本／增量、reasoning item、工具或 MCP 调用、文件变更、命令、未知 item 类型及本轮新增 token usage。允许的仅是该轮 userMessage 的接收记录。任何观测缺失或无法归属则失败关闭。
- 当前轮不是原生 active goal 的自动续轮；若 goal 状态查不到，或同一线程还存在其他 active turn，也失败关闭。这个限制先保护长程目标，待单独验收后才能放宽。
- 当前会话仍由同一进程代次拥有、用户未点停止、没有新消息抢占，且尚未用完 2 次自动恢复额度。

“安全”指**不在已观察到输出或副作用后自动重做**，不承诺上游完全没有计算或收费；UI 文案不得保证零额外额度。

## 恢复状态机

1. 接到合格 failed turn 后保持当前可见轮 busy，记录固定脱敏类别 `workspace-routing-timeout` 与重试序号，不直接发 fatal error。若先收到同类原生 `error` 通知，只等待至多 5 秒获取相同 turn ID 的 terminal `turn/completed`；等不到便失败关闭，绝不凭通知单独重试。
2. 每次付费重试前等待 5 秒（第二次 20 秒），然后调用原生 `account/read({refreshToken:false})` 作健康探测（不提交模型轮次）。单次 RPC 最多等待 20 秒；需要 ChatGPT 路由的帐号须得到非空 `workspaceRouting`。若第一次探测失败，20 秒后最多再探测一次；仍失败就停止。不把探测算作付费重试，也不在路由仍不可用时盲目提交。所有等待与 RPC 都响应用户停止。
3. 路由恢复后在**当前线程**调用 `thread/fork({threadId, beforeTurnId: failedTurnId})`。只在得到明确新 thread ID 后更新 Eas-Term `resumeId`，保留旧线程；分叉失败或结果不明则停止，不再提交。
4. 在新线程以原模型、沙箱、角色／MCP 限制及用户请求调用一次 `turn/start`。每个新线程仅一次付费提交；ACK 丢失时沿用现有“只观察原轮，不重新提交”规则。
5. 新轮成功则按现有 `turn.completed` 正常结算并清除恢复状态；再次满足相同严格条件才可进行第二次分叉。两次之后仍失败，显示**明确类别与“已自动恢复 2 次”**，不再继续。失败轮若无可归属的 token 事件，不记虚构的 0 成本；分叉后的累计用量须与本轮新增用量区分，不能把继承的历史 token 再记入 UI 总数。无法准确归属时保留未知，不猜数。

状态由原生桥持有；只把固定枚举、序号和新 thread ID 送到会话层，绝不把原生任意错误正文写入 UI 或诊断日志。退出、取消、网络断线不会遗留后台计时器或无主 Codex 进程。

## 用户可见行为

- 同一条用户提问只显示一次；恢复时在现有“正在处理”区域显示中性状态：“连接波动，正在恢复（1/2）”，不新增一条红色错误。用户原有“停止”始终有效。
- 成功后状态消失；最终失败才出现一次可操作的脱敏说明：“Codex 工作区路由持续超时；已尝试恢复 2 次。请稍后重试。”若探测失败而未真正提交两次，显示**实际次数**，不虚报。
- 新原生 thread ID 只更新当前会话的恢复指针；历史用户消息、已完成答案、用量统计不重复追加。旧 Codex 线程不删除。

## 失败关闭与非目标

- 不重试所有 `unknown`、认证失败、MCP 插件失败、原生进程退出、状态查询超时、模型已输出后断流、工具执行后失败、主动停止、goal 自动续轮及不支持分叉的 CLI。
- 不修改 Codex 内部 5 次网络重试、Clash 规则、用户凭证，也不在应用启动时做常驻网络探测。
- 不把“原生终止后再开一个轮次”宣传成“原轮无损续跑”；分叉原轮是可审计的恢复策略，可能增加等待时间和 token 消耗。

## 验收与门禁

先加失败测试，再实现：精确错误 + 无活动时最多两次 `fork → turn/start`；分叉锚点排除 failed turn；三次均失败后仅一次 fatal；成功后同一 UI 轮次收束。反例覆盖任意 assistant delta、reasoning、工具／文件／未知 item、usage、新 goal、取消、ACK 丢失、RPC 断线、fork 不支持或响应不明，均断言**无额外付费提交**。验证脱敏日志不含提示词、路径、URL 或凭证。现有 Codex 目标续跑与 27 项桥接基线不得回退。

随后运行定向测试、`npm run check`、构建，并用隔离应用 + 本地 Responses 夹具注入两次故障，亲眼核对恢复提示、停止、最终失败和 resumeId。真实线上断网、Windows 实机及实际计费不能由本地夹具证明，须单列“未验证”。

环境备注：本隔离 worktree 的 27 项 Codex 桥接／错误测试通过。`npm ci` 的 `electron-rebuild` postinstall 在本机 Node 26.5.0 下失败；`npm ci --ignore-scripts` 可安装依赖，但完整构建门禁尚未通过，实施前需解决或如实报告，不得把跳过 postinstall 当作通过。

协议依据：[Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)、本机正式使用的 Codex 0.156.1 通过 `app-server generate-json-schema --experimental` 生成的 `ThreadForkParams.beforeTurnId` 描述；官方 [workspace routing 实现](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor/workspace_routing.rs) 将同名超时归在帐号路由发现流程。实际行为以受控夹具验收为准，不仅凭最新主干文档推断 0.156.1。
