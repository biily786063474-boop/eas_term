#!/usr/bin/env node
// Session-scoped stdio adapter. Never discovers credentials, restarts a CLI or retries tools/call.
import readline from 'node:readline'
import http from 'node:http'
import crypto from 'node:crypto'
const connectionId = crypto.randomUUID()
const module = process.env.EAS_CAPABILITY_MODULE
const port = Number(process.env.EAS_TERM_PORT)
const lease = process.env.EAS_CAPABILITY_LEASE
const configured = !!module && !!port && !!lease
let heartbeat
let pinging = false
function startHeartbeat() {
  if (heartbeat || !configured) return
  heartbeat = setInterval(async () => {
    if (pinging) return
    pinging = true
    try { await request('ping', {}) } catch { /* Never retry a tool or acquire authority on heartbeat failure. */ }
    finally { pinging = false }
  }, 15_000)
  heartbeat.unref()
}
function request(method, params) {
  return new Promise((resolve, reject) => {
    if (!configured) return reject(new Error('此进程没有受管能力会话'))
    const body = JSON.stringify({ module, connectionId, method, params })
    const req = http.request({ host: '127.0.0.1', port, path: '/capability/rpc', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-eas-capability': lease },
      timeout: method === 'tools/call' ? 15 * 60_000 : 30_000
    }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(text)
          if (!result.ok) reject(new Error(result.error || '内置能力调用失败'))
          else resolve(result.result)
        } catch (error) { reject(error) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('能力连接超时；工具执行结果可能未知，不自动重试')))
    req.end(body)
  })
}
const send = message => process.stdout.write(JSON.stringify(message) + '\n')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  const { id, method, params } = message
  if (id === undefined) return
  try {
    let result
    if (!configured && method === 'initialize') result = { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'eas-capabilities', version: '1.0.0' } }
    else if (!configured && method === 'tools/list') result = { tools: [] }
    else result = await request(method, params ?? {})
    if (method === 'initialize' || method === 'tools/list') startHeartbeat()
    send({ jsonrpc: '2.0', id, result })
  } catch (error) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error.message || error) } })
  }
})
rl.on('close', () => { clearInterval(heartbeat); void request('close', {}).catch(() => {}).finally(() => process.exit(0)) })
