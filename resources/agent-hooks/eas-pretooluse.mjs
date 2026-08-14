#!/usr/bin/env node
// Claude Code 的 PreToolUse hook：把这次工具调用交给 Eas-Term 弹卡片问人，阻塞等回答。
//
// 这个脚本是**外部进程**，Claude Code 会等它退出才继续 —— 这正是审批卡片成立的前提
// （实测阻塞 4 秒后返回 allow，文件真的被创建；Task 7 审查阶段进一步实测阻塞 70 秒也
// 不会被 Claude Code 自己的默认 hook 超时掐断，所以下面的等待时长可以放心贴近服务端的
// APPROVAL_TIMEOUT_MS）。
// 端口与令牌由 Eas-Term 起会话时经 env 注入，与既有 MCP 那条通道同源。
//
// **兜底一律是拒绝**：拿不到端口、请求失败、超时，全都 deny。
// 前端崩了或用户没看见时默默放行一次写文件/跑命令，是这里最不能犯的错。
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
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk

  const port = process.env.EAS_TERM_PORT
  const token = process.env.EAS_TERM_TOKEN
  if (!port || !token) return deny('Eas-Term 没能确认这次操作（拿不到本机通道）')

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return deny('Eas-Term 没能确认这次操作（hook 输入解析失败）')
  }

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
