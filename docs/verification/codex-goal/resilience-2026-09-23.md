# 原生任务中断容错补丁

针对状态查询偶发超时导致的强制失败：已启动任务后的只读 `thread/goal/get` 允许两次重查，绝不重发付费 `turn/start`。错误界面区分状态超时、接口超时、进程退出、协议问题、交互请求不支持，且不回显不可信原文。

回归测试涵盖一次超时后恢复、同一轮只调用一次 `turn/start`、既有失败关闭/取消边界、敏感文本不进入提示。全量检查与隔离应用验证结果以执行日志为准；线上真实模型中断与 Windows 尚未验证。此补丁不保证原生进程退出后无损恢复，进程退出时必须先检查原任务结果。

本次隔离应用复验：构建成功；`verify-codex-goal-ui.mjs` 使用临时 HOME、真实 Codex CLI、localhost Responses 夹具与 Electron IPC，观察到两轮回复、第二轮期间保持 busy、无重复 turn/start、普通 resume 正常结束、用户停止不重启。截图保存在临时验收 profile，未写入其他 agent 的工作树。状态查询超时注入与脱敏错误分类由单测验证；真实线上断网恢复未验证。

追加故障矩阵：① turn/start 回包丢失但原生事件已到，继续原任务；② 回包丢失、事件延迟，短时等待同一任务；③ 回包和事件都无，明确失败、不重发；④ 原生任务失败/用户取消，不伪造成功；⑤ 状态查询瞬时超时只重查只读状态，持续超时失败关闭。所有分支均断言最多一次 `turn/start`。
⑥ app-server stdout 单独关闭但进程尚未 exit，桥接立即失败并收尾，避免永远 busy；不重发原任务。该边界由管道关闭故障注入测试验证。

最终检查：`npm run check` 共 3620 项，3601 通过、19 跳过、0 失败；`npm run build` 通过。首次隔离 Electron 复验在任何任务请求前的 CDP `Runtime.evaluate` 启动阶段超时（requests=0），保留原时限重跑通过：真实 CLI + localhost 夹具 5 项，截图已人工查看。此为本机隔离应用复验，不等同于线上服务断线、进程崩溃或 Windows 验收。
现场概率仍需观察：现有旧版日志只有 code=1 / busy=true，没有根因分类，无法倒推“80% 不会中断”。新版新增固定脱敏故障类别日志，后续版本上线后才能统计实际各类发生率；目前不据此宣称 80% 成功率。
追加审计发现：原生 `turn/completed.error.message` 曾进入桥接异常，虽 UI 有兜底文案，但异常/测试日志可能带隐私。现改为安全类别；401/Unauthorized 类保留登录提示，其余不回显原文。已补故障注入回归。
可选 MCP 的 401/握手失败不会误判为主模型账号故障，也不会强制关闭正在执行的轮次；输出脱敏非致命警告。补有故障注入测试。一次全量检查在新增这个预期失败用例的编写过程中运行，出现该用例失败；修复后专项通过，最终全量复跑另记。

最终复跑：`npm run check` 3624 项，其中 3605 通过、19 跳过、0 失败；`npm run build` 通过。隔离 Electron + 真实 Codex CLI + 本地 Responses 夹具 5 项通过，人工查看两轮回复截图。此为故障路径覆盖与本地验收，不是生产成功概率。未触及正在使用的正式应用；本记录在功能分支验收时写成；随后按用户指令提交并合入本地 main，不推送、不发布。

## 2026-09-23：精确路由超时的有界分叉恢复（隔离分支）

仅在原生 `turn/completed failed` 的错误全文**恰为** `workspace routing discovery timed out`、付费启动 ACK 确认、无 assistant／工具／用量活动、无其他活跃轮次、goal 明确为 null 且用户未停止时，允许最多两次恢复。每次先退避（5 秒／20 秒），只读 `account/read(refreshToken:false)` 最多探测两次，再以 `thread/fork.beforeTurnId` 排除失败轮；确认新 thread ID 后才提交下一次 `turn/start`。不修改代理、凭证、旧线程，也不重试其他原生错误。分叉累计 token 无可靠基线时标为未知，避免重复计算。

验收（本 worktree，Node 22 兼容环境）：

- `node --test src/main/codexTaskBridge.test.mjs`：48 项全过；包含首次健康探测失败、二次恢复、活动／用量／goal／ACK 不明、在退避／健康探测／分叉时取消等失败关闭边界。
- `npm exec --yes --package=node@22 -- node scripts/verify-codex-goal-native.mjs`：原有真实 Codex CLI + localhost Responses 正常路径通过；本地服务**不能**模拟真实帐号的工作区路由故障。
- `npm exec --yes --package=node@22 -- node scripts/verify-codex-goal-ui.mjs`：原有隔离 Electron 正常路径通过。
- `npm exec --yes --package=node@22 -- node scripts/verify-codex-safe-retry-ui.mjs`：隔离 Electron + fake app-server 故障注入通过；首次健康探测失败、第二次恢复；真实 UI 可见 1/2、2/2 与完成状态；两个 `beforeTurnId` 分叉、总共三个付费提交、resumeId 指向最终线程；停止后未继续提交，第三次失败后没有第四次提交。截图：`safe-retry-1-of-2.png`、`safe-retry-2-of-2.png`、`safe-retry-completed.png`（同目录，已人工查看）。测试夹具不使用真实帐号或模型。
- 全量 `npm exec --yes --package=node@22 -- npm run check`：3668 项，3649 通过、19 跳过、0 失败；同环境 `npm run build` 退出码 0。

未验证：真实线上 Codex 帐号路由超时的触发与恢复成功率、实际账单、Windows 构建。首次隔离应用 CDP 启动曾偶发超时；最终成功执行使用全新临时 HOME/userData，未触及正式版。`npm ci` 的 Node 26 postinstall 遇 ESM `require` 错误，改在 Node 22 完成 postinstall/Electron 安装后再运行构建与验收；这不是产品恢复路径的结果。
