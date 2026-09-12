#!/usr/bin/env node
// Eas-Term 的 MCP Server（stdio，零依赖手写 JSON-RPC）。
//
// 由跑在 Eas-Term 终端里的 Claude Code / Codex 启动：
//   环境变量 EAS_TERM_PORT / EAS_TERM_TOKEN / EAS_PTY_ID / EAS_PROJECT 由 app 的 PTY 自动注入，
//   所以工具调用天然知道「我在哪个终端 → 属于哪个 Frame」，不需要 AI 指定。
//
// 传输：MCP stdio = 一行一条 JSON-RPC 消息（换行分隔），响应写 stdout。

import readline from 'readline'
import http from 'node:http'
import fs from 'node:fs'

const PORT = process.env.EAS_TERM_PORT
const TOKEN = process.env.EAS_TERM_TOKEN
// EAS_TEAM_ROLE 只有团队派生的会话才有 —— 它让「调用方是不是成员」成为**事实**
// 而不是靠 cwd 反推的猜测（那个猜测会把同项目里的主 agent 也算成成员）
const CTX = {
  ptyId: process.env.EAS_PTY_ID,
  project: process.env.EAS_PROJECT,
  teamRole: process.env.EAS_TEAM_ROLE
}

// Single catalog shared by the legacy stdio entry and the built-in host.
const TOOLS = JSON.parse(fs.readFileSync(new URL('./workbench-tools.json', import.meta.url), 'utf8'))

/** 会阻塞着等的工具，这条链路会挂很久 —— 名单与主进程 `mcpBridge.ts` 的 `LONG_WAITS`
 *  必须一致，加工具时两处一起改。
 *
 *  等的不一定是人：`wiki_archive_plan` / `team_spawn` 等用户点确认，
 *  而 `team_status` 的等待模式是挂着等某个子 agent 交活（渲染层 8 分钟）。
 *  判据是「会不会阻塞着等」，不是「等的是谁」。
 *  `merge_preflight` / `repo_impact` 则是**慢**（merge-tree 30s、analyzeProject 大仓库几十秒），
 *  同样超过普通那道闸，一并放进来。 */
const LONG_WAITS = new Set(['secret_check', 'request_secret', 'report_secret_invalid', 'wiki_archive_plan', 'team_spawn', 'team_status', 'merge_preflight', 'repo_impact'])

/** 普通工具 30 秒足够（主进程那侧 15 秒就会先返回错误）；
 *  长等待的那些给 15 分钟 —— **必须比主进程的 10 分钟长**，
 *  这样超时永远由主进程判，用户能收到那句写清楚的话，而不是一个连接层的报错。 */
const CALL_TIMEOUT_MS = (tool) => (LONG_WAITS.has(tool) ? 15 * 60 * 1000 : 30_000)

/**
 * 用 node:http 而不是 fetch。
 *
 * **不是风格问题，是 fetch 在这里做不到。** Node 的 fetch 走 undici，它的
 * `headersTimeout` 默认 300 秒、且是**独立的内部闸** —— 实测：给
 * `AbortSignal.timeout(15 分钟)` 也没用，301 秒照样抛
 * `UND_ERR_HEADERS_TIMEOUT`。要调它得拿到 undici 的 Agent，而这个 shim 是
 * 零外部依赖的 .mjs，装不了 undici。
 *
 * 后果不是「慢一点」：team_spawn 那张清单名义上能等 10 分钟，实际 5 分钟就
 * 从最外层断掉，用户点了也没意义 —— 而他看到的会是一个连接错误，
 * 不是主进程那句「用户一直没有处理那张派活清单」。
 * （2026-08-19 由一个 cross-checker agent 抓到，我照它给的方向验了一遍才确认。）
 */
function postInvoke(body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/invoke',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-eas-token': TOKEN
        },
        // 这一条才是真正管用的那个闸
        timeout: timeoutMs
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch {
            resolve({ ok: false, error: `HTTP ${res.statusCode}` })
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`等 Eas-Term 响应超时（${Math.round(timeoutMs / 1000)}s）`))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function callApp(tool, args) {
  if (!PORT || !TOKEN) {
    throw new Error('未检测到 Eas-Term 环境（EAS_TERM_PORT/TOKEN 缺失）——请在 Eas-Term 的终端里运行')
  }
  const j = await postInvoke(JSON.stringify({ tool, args, ctx: CTX }), CALL_TIMEOUT_MS(tool))
  if (!j.ok) throw new Error(j.error || '调用失败')
  return j.data
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  const raw = line.trim()
  if (!raw) return
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      ok(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'eas-term', version: '1.0.0' }
      })
    } else if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
      // 通知无需响应
    } else if (method === 'tools/list') {
      // 不在 Eas-Term 的终端里（没有注入的端口/令牌）就一个工具都不报。
      // 这条配置是全局的（~/.claude.json / ~/.codex/config.toml），用户在别处起 claude 也会连上这个
      // server —— 那时候报一堆调用必失败的工具纯属噪声，不如干脆不显示，用户完全无感。
      ok(id, { tools: PORT && TOKEN ? TOOLS : [] })
    } else if (method === 'tools/call') {
      const name = params?.name
      if (!TOOLS.some((t) => t.name === name)) {
        fail(id, -32602, `未知工具 ${name}`)
        return
      }
      try {
        const data = await callApp(name, params?.arguments ?? {})
        ok(id, { content: [{ type: 'text', text: JSON.stringify(data) }] })
      } catch (e) {
        // 工具级错误按 MCP 约定放在 result.isError，模型能看到并自行处理
        ok(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true })
      }
    } else if (method === 'ping') {
      ok(id, {})
    } else if (id !== undefined) {
      fail(id, -32601, `不支持的方法 ${method}`)
    }
  } catch (e) {
    if (id !== undefined) fail(id, -32603, String(e.message || e))
  }
})
