#!/usr/bin/env node
// 自家插件在 AI 对话会话里的**转发 shim**（stdio MCP server，零依赖）。
//
// 为什么不让 harness 直接 spawn 插件进程（设计稿决定 #2）：
//   · 面板那边已经由宿主起了一个插件进程；harness 再起一个，就是两份状态、两倍内存
//   · harness 直连的话，模型调了工具宿主一无所知，「模型调了 board_add → 面板刷新」做不到
// 所以这里只做**转发**：把 harness 发来的 initialize / tools/list / tools/call /
// resources/read 原样 POST 到 Eas-Term 网关的 /plugin/rpc，网关转给宿主里那**一个**插件进程。
// 和 eas-mcp.mjs 同一条链路、同一把 token，没有新开端口。
//
// 环境变量（由 agent-mcp.json 的 env 与会话 spawn env 注入）：
//   EAS_PLUGIN        插件名（agent-mcp.json 写死）
//   EAS_TERM_PORT/TOKEN 网关（会话 spawn 时 mcpEnv() 注入，harness 传给子进程）
//   EAS_PROJECT       会话 cwd —— 塞进 tools/call 的 _meta.eas.context.cwd，插件 server 不猜
//
// 生命周期：initialize 时向网关登记随机 shimId；每 15s 心跳；stdin 关了就 bye。
// 网关 45s 没心跳即视为这个会话没了，把它对插件进程的引用释放掉。

import readline from 'readline'
import http from 'node:http'
import crypto from 'node:crypto'

const PLUGIN = process.env.EAS_PLUGIN
const PORT = process.env.EAS_TERM_PORT
const TOKEN = process.env.EAS_TERM_TOKEN
const PROJECT = process.env.EAS_PROJECT
const SHIM_ID = crypto.randomBytes(8).toString('hex')
const HEARTBEAT_MS = 15_000
/** tools/call 可能很长（插件自己的工具，我们不知道它要跑多久），给 10 分钟 */
const CALL_TIMEOUT_MS = 10 * 60 * 1000
const QUICK_TIMEOUT_MS = 30_000

function post(path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!PORT || !TOKEN) return reject(new Error('不在 Eas-Term 里'))
    const data = JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(PORT),
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          'x-eas-token': TOKEN
        },
        timeout: timeoutMs
      },
      (res) => {
        let s = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (s += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(s))
          } catch {
            reject(new Error('网关响应不是 JSON'))
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error('网关超时'))
    })
    req.on('error', reject)
    req.end(data)
  })
}

async function rpc(method, params, timeoutMs) {
  const j = await post('/plugin/rpc', { plugin: PLUGIN, shimId: SHIM_ID, project: PROJECT, method, params }, timeoutMs)
  if (!j.ok) {
    const e = new Error(j.error || `${method} 失败`)
    e.code = j.code
    throw e
  }
  return j.result
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

let beat = null
function startHeartbeat() {
  if (beat) return
  beat = setInterval(() => {
    post('/plugin/heartbeat', { plugin: PLUGIN, shimId: SHIM_ID }, QUICK_TIMEOUT_MS).catch(() => {})
  }, HEARTBEAT_MS)
  beat.unref()
}
async function bye() {
  if (beat) clearInterval(beat)
  try {
    await post('/plugin/bye', { plugin: PLUGIN, shimId: SHIM_ID }, 3000)
  } catch {
    /* 网关不在了也无所谓 */
  }
}

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
      if (!PLUGIN || !PORT || !TOKEN) {
        // 不在 Eas-Term 里：照样握手成功但一个工具都不报（同 eas-mcp.mjs 的纪律）
        ok(id, {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: `eas-plugin-${PLUGIN || 'unknown'}`, version: '1.0.0' }
        })
        return
      }
      const r = await rpc('initialize', params, QUICK_TIMEOUT_MS)
      startHeartbeat()
      ok(id, r)
    } else if (method?.startsWith('notifications/')) {
      // 通知无需响应
    } else if (method === 'tools/list') {
      if (!PLUGIN || !PORT || !TOKEN) return ok(id, { tools: [] })
      ok(id, await rpc('tools/list', params ?? {}, QUICK_TIMEOUT_MS))
    } else if (method === 'tools/call') {
      // 把会话 cwd 带给插件：面板那边宿主会注入同样形状的 _meta.eas.context
      const p = { ...(params ?? {}) }
      p._meta = { ...(p._meta ?? {}), eas: { context: { cwd: PROJECT ?? '' } } }
      ok(id, await rpc('tools/call', p, CALL_TIMEOUT_MS))
    } else if (method === 'resources/read' || method === 'resources/list') {
      ok(id, await rpc(method, params ?? {}, QUICK_TIMEOUT_MS))
    } else if (method === 'ping') {
      ok(id, {})
    } else if (id !== undefined) {
      fail(id, -32601, `不支持的方法 ${method}`)
    }
  } catch (e) {
    if (id !== undefined) fail(id, typeof e.code === 'number' ? e.code : -32603, String(e.message || e))
  }
})
rl.on('close', () => {
  void bye().finally(() => process.exit(0))
})
