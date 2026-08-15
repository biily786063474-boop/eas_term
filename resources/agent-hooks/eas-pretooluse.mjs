#!/usr/bin/env node
// Claude Code 的 PreToolUse hook：把这次工具调用交给 Eas-Term 弹卡片问人，阻塞等回答。
//
// 这个脚本是**外部进程**，Claude Code 会等它退出才继续 —— 这正是审批卡片成立的前提
// （实测阻塞 4 秒后返回 allow，文件真的被创建；Task 7 审查阶段进一步实测阻塞 70 秒也
// 不会被 Claude Code 自己的默认 hook 超时掐断，所以下面的等待时长可以放心贴近服务端的
// APPROVAL_TIMEOUT_MS）。
// 端口与令牌由 Eas-Term 起会话时经 env 注入，与既有 MCP 那条通道同源。
//
// **兜底一律是拒绝**——但那只对"确认是我们管的会话"之后才成立。见下面 EAS_AGENT_CHAT_SESSION
// 那道最先要过的门：拿不到端口、请求失败、超时，全都 deny；但压根不是 agent-chat 会话时，
// 是**无声放行**（无输出，交还给 Claude Code 正常的权限流程），不是 deny。
//
// ⚠️ 2026-08-14 全分支评审 C1（Critical，必读）：这份 hook 装的是 matcher:'*'，对项目里
// **所有** Claude Code 进程生效，不只 agent-chat 起的那个——用户在 Eas-Term 终端里自己敲的
// `claude`（pty.ts 同样注入 EAS_TERM_PORT/TOKEN，同源于 mcpBridge.ts 的 mcpEnv()）、甚至
// app 外面跑的 `claude`，都会经这同一条 hook。老实现只认端口/令牌，等于把用户自己在这个
// 项目里的日常 Claude Code 会话永久废掉（没有端口/令牌时秒拒；有的话——比如 Eas-Term
// 终端里的 claude——hook POST 进去找不到对应会话，没人 resolve，卡满 5 分钟再 deny）。
// 修法：只有 session.ts 的 restartAndDeliver 起的会话才会注入 EAS_AGENT_CHAT_SESSION，
// 这是**唯一**用来判断"这次工具调用是不是 agent-chat 会话"的信号——不能用 EAS_TERM_PORT/
// TOKEN/PROJECT 代替，PTY 终端也注入那几个，拿它们当标记等于没有隔离。
//
// ⚠️ hookResponseBody 的响应体形状与 src/main/agentChat/approvalRoute.ts 里同名的函数
// 必须保持逐字一致——这是独立进程，import 不到那份 TS 代码，只能各写一份。
// **改一处必须改另一处**。FETCH_TIMEOUT_MS 同理对应那边的 APPROVAL_TIMEOUT_MS。
//
// 全部逻辑包进 main()、靠 return 中断，而不是让 deny() 内部调 process.exit()：
// process.exit() 会截断还没 flush 完的 stdout 管道写入（Node 文档明确警告过这条），
// 而这里的写入往往正是"兜底拒绝"路径——最不能被截断成半截 JSON 的地方（半截 JSON
// 会让 Claude Code 解析失败，兜底反而变成了不确定行为）。改成只设 process.exitCode、
// 什么都不做，让 Node 在事件循环清空、这次写入真正 flush 完之后自然退出。
// ESM 顶层不允许裸 return，所以要包一层函数才能用 return 中断——这也是 deny() 从
// "调用即终止"变成"调用后调用方必须自己 return"的原因，下面每个调用点都改成了
// `return deny(...)`。
import { hookResponseBody } from './responseBody.mjs'

// 与 src/main/agentChat/approvalRoute.ts 的 APPROVAL_TIMEOUT_MS（5 分钟）对应，
// 外加 10 秒缓冲：正常情况下让服务端自己的超时先触发（那边的 deny reason 更精确，
// 写着"等待超时"），这边的 AbortSignal 只兜底服务端彻底没反应的更坏情况——
// 比如 Eas-Term 崩了但端口还占着，连接能建立却永远不回应，没有这个会导致 hook
// 挂到天荒地老（SIGKILL 才能停，Task 7 审查阶段实测确认过）。
// import 不到 TS 那份常量，只能各写一份字面量，**改一处必须改另一处**。
const FETCH_TIMEOUT_MS = 5 * 60 * 1000 + 10_000

function deny(why) {
  process.stdout.write(hookResponseBody('deny', why))
  process.exitCode = 0
}

async function main() {
  // 先把 stdin 读完，不管接下来要不要用它——Claude Code 那边在等这个管道写完/关闭，
  // 提前退出不读，大 payload（比如写一个大文件）的场景可能撞上 EPIPE。这一步的开销
  // 与之前完全一样，只是决定"要不要用它"的判断往后挪了一步。
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk

  // 最先要过的门：这次工具调用是不是 agent-chat 会话起的。不是的话——用户在 Eas-Term
  // 终端里自己敲的 claude，或者 app 外面跑的 claude，都不会有这个变量——这个 hook 对它
  // 没有意见。按 Claude Code 的 hook 约定：**无输出 = 本 hook 无意见**，交还给正常的
  // 权限流程，不阻塞也不拒绝（见文件头 C1）。
  const sessionId = process.env.EAS_AGENT_CHAT_SESSION
  if (!sessionId) {
    process.exitCode = 0
    return
  }

  const port = process.env.EAS_TERM_PORT
  const token = process.env.EAS_TERM_TOKEN
  if (!port || !token) return deny('Eas-Term 没能确认这次操作（拿不到本机通道）')

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return deny('Eas-Term 没能确认这次操作（hook 输入解析失败）')
  }
  // 附上我们自己的会话标记，让主进程能直接按 id 点名找到会话，不必再靠 Claude 原生
  // session_id 反查 resumeId（那条路径在 session.ready 事件把 resumeId 落进
  // SessionRecord 之前会找不到会话，见 approvalRegistry.ts 的 HookPayload.eas_session_id）。
  payload.eas_session_id = sessionId

  try {
    const res = await fetch(`http://127.0.0.1:${port}/agent-approval/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-eas-token': token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) return deny(`Eas-Term 没能确认这次操作（HTTP ${res.status}）`)
    const j = await res.json()
    process.stdout.write(hookResponseBody(j.decision === 'allow' ? 'allow' : 'deny', j.reason ?? ''))
  } catch (e) {
    return deny('Eas-Term 没能确认这次操作（' + (e?.message ?? '请求失败') + '）')
  }
}

await main()
