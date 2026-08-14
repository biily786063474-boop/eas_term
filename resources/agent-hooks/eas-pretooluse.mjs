#!/usr/bin/env node
// Claude Code 的 PreToolUse hook：把这次工具调用交给 Eas-Term 弹卡片问人，阻塞等回答。
//
// 这个脚本是**外部进程**，Claude Code 会等它退出才继续 —— 这正是审批卡片成立的前提
// （实测阻塞 4 秒后返回 allow，文件真的被创建）。
// 端口与令牌由 Eas-Term 起会话时经 env 注入，与既有 MCP 那条通道同源。
//
// **兜底一律是拒绝**：拿不到端口、请求失败、超时，全都 deny。
// 前端崩了或用户没看见时默默放行一次写文件/跑命令，是这里最不能犯的错。
//
// ⚠️ hookResponseBody 的响应体形状与 src/main/agentChat/approvalRoute.ts 里同名的函数
// 必须保持逐字一致——这是独立进程，import 不到那份 TS 代码，只能各写一份。
// **改一处必须改另一处**。
import { hookResponseBody } from './responseBody.mjs'

const deny = (why) => {
  process.stdout.write(hookResponseBody('deny', why))
  process.exit(0)
}

let raw = ''
for await (const chunk of process.stdin) raw += chunk

const port = process.env.EAS_TERM_PORT
const token = process.env.EAS_TERM_TOKEN
if (!port || !token) deny('Eas-Term 没能确认这次操作（拿不到本机通道）')

let payload
try {
  payload = JSON.parse(raw)
} catch {
  deny('Eas-Term 没能确认这次操作（hook 输入解析失败）')
}

try {
  const res = await fetch(`http://127.0.0.1:${port}/agent-approval/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eas-token': token },
    body: JSON.stringify(payload)
  })
  if (!res.ok) deny(`Eas-Term 没能确认这次操作（HTTP ${res.status}）`)
  const j = await res.json()
  process.stdout.write(hookResponseBody(j.decision === 'allow' ? 'allow' : 'deny', j.reason ?? ''))
} catch (e) {
  deny('Eas-Term 没能确认这次操作（' + (e?.message ?? '请求失败') + '）')
}
