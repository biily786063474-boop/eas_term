# 用户现场交接原文 · 2026-09-10

交给 Eas-Term 那边改。2026-09-10 从狼人杀项目里踩到，根因是读 app.asar 主进程定位的。

问题一句话
画布上直接开的 Claude Code / codex 节点拿不到密钥柜里的 key：eas-secret 报「这个终端没有取密钥的凭证」，
request_secret 用户点了同意也没用，agent 只能开一个终端节点让用户手跑一行。每次都断流。

根因
主进程两条 spawn 路径待遇不一样：

终端节点 pty:spawn    agent 会话 spawn（createAgentChatSession 附近）
EAS_SECRET_TOKEN    issueSecretToken(ptyId, autoInjectGroups())    没调
secret shim 进 PATH    prependPath(env, ensureSecretShim())    没加 → eas-secret: command not found
secretsForRun 用 x-eas-secret-token 查 secretTokens → ptyId → ptyGrants，查不到直接拒
secrets:grantToPty(ptyId, group) 是 request_secret 批准后的授权入口，agent 节点没 ptyId，批了落空
secret_check 的 next 只看 inVault / inThisTerminal，没看调用方有没有凭证，所以对没凭证的进程仍说「不用开新终端」——误导 agent 绕圈
这不是安全设计，是漏配：eas-pty-launcher.mjs 从终端里启 claude 时刻意保留了 EAS_SECRET_TOKEN
（注释 "Secret grants have their own PTY boundary and are deliberately preserved"）。
「agent 能碰密钥」已经是既定决策，只是画布直接起的 agent 没走同一条路。用户在终端里敲一句 claude 就绕过去了。

优化方向：凭证按「会话」发，不按「终端」发
issueSecretToken 的 key 从 ptyId 泛化成 sessionKey（pty:<id> 或 agent session id）。四处改动：

1. agent spawn 补发通行证 + shim 目录
拼 env 的地方（现在是 PROBE_ENV + mcpEnv + capabilitySessionEnv + approvalEnv + launch.env）加：

EAS_SECRET_TOKEN: issueSecretToken(live.rec.id, autoInjectGroups())
prependPath(env, ensureSecretShim())
会话销毁处（killAgentChatSessionsForWebContents 和正常 exit，已有 revokeCapabilitySession(id) 的位置）加 forgetPty(live.rec.id)，
token 跟会话同生共死。

omp（ACP）那条路注意：ompBaseEnv 的 SCRUB_KEYS 会把 EAS_SECRET_TOKEN 删掉，要扩到 omp 得在 scrub 之后再加回去。

2. request_secret 的授权落到 agent 会话上
secrets:grantToPty(ptyId, group) 接受 agentSessionId。capabilitySessionEnv 的 ctx 已经带 agentSessionId，
随 /invoke 的 ctx 进来，渲染层批准回调改成 ctx.agentSessionId ?? ctx.ptyId 即可，身份是现成的。

3. secret_check 加 hasCredential，next 按它分支
有凭证 + 在柜里 → 现在的「用包装命令直接跑」
没凭证 → 明说「这个节点没有取密钥的凭证，重开节点」，别再说「不用开新终端」
4. 审计日志 ptyId → sessionKey
密钥柜审计面板能看到「哪个 agent 节点用了哪条」，跟终端节点一样可追溯。

不要做的
不要像终端节点那样把自动注入组的值直接塞进 agent 的 env。终端那么做是用户自己敲 $VAR 顺手；
agent 的进程环境一句 env 就进对话，正是密钥柜要防的。agent 只发通行证、只走 eas-secret run 包装，值只在子命令里活。
不要让 secret_check 回值——第一条红线。
不要加 secret_run(vars, cmd) 让主进程代跑——shell 执行搬进主进程，cwd / 权限 / 审批钩子全乱，
Claude Code 自己的 Bash 才是它熟悉的执行面。
改完的安全边界
agent 节点与终端节点同一套授权模型：自动注入组默认可用；其他组走 request_secret 弹窗当场批；
一次性通行证按进程发、不落盘、会话关即作废；值永远不出现在 agent 的对话和进程环境里。

验收（e2e 三条）
agent 节点里 eas-secret run --vars X -- sh -c 'echo ${#X}' 回长度
未授权组：request_secret 批准后再跑一次能过
关掉节点后拿旧 token 打 /secret-env 被拒

---

## 接收方边界说明（非用户原文）
本次按现有 wrapper 授权兼容路线修复，不新增主进程任意命令执行接口，不推进上一轮推荐的受控业务代理。
“不主动注入 Agent 环境、不作为工具结果返回原值”可以验收；任意子命令仍可打印原值，不能声称绝对明文隔离。
