#!/usr/bin/env node
// 「番茄钟」插件的 MCP server（stdio，零依赖）。结构照样板「看板」来：
// 只用标准 MCP（工具 + ui:// 资源）+ 面板桥，没有任何 Eas-Term 内部 IPC，
// 拿到别的 MCP Apps 宿主也能跑。
//
// 状态：<cwd>/.eas/pomodoro.json —— 一个计时会话的**权威来源**是这个文件，
// 面板只是它的视图（本地按 startedAt 倒数、写类工具后刷新）。cwd 来自
// tools/call 的 _meta.eas.context.cwd（面板由宿主注入、会话由转发 shim 注入）。**不猜 cwd**。
import readline from 'readline'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL_URI = 'ui://pomodoro/panel'
const MODES = { focus: 25, break: 5 } // 默认分钟数

const TOOLS = [
  {
    name: 'pomodoro_show',
    description: '打开番茄钟面板（专注 / 休息倒计时）',
    inputSchema: { type: 'object', properties: {} },
    _meta: { 'ui/resourceUri': PANEL_URI }
  },
  {
    name: 'pomodoro_start',
    description: '开始一段计时。mode=focus（默认 25 分钟专注）或 break（默认 5 分钟休息）；minutes 可覆盖',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['focus', 'break'], description: '专注 focus / 休息 break，默认 focus' },
        minutes: { type: 'number', description: '分钟数（1–180），不传按 mode 默认' }
      }
    }
  },
  {
    name: 'pomodoro_stop',
    description: '停掉当前计时（不计入完成记录）',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'pomodoro_status',
    description: '看当前计时状态：是否在跑、剩多少秒、今天完成了几个',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'pomodoro_done',
    description: '把当前计时标记为完成并记一笔（面板倒数到 0 时调用）',
    inputSchema: { type: 'object', properties: {} }
  }
]

function cwdOf(params) {
  const cwd = params?._meta?.eas?.context?.cwd
  if (typeof cwd !== 'string' || !cwd) throw new Error('缺项目路径（_meta.eas.context.cwd）—— 这个工具要在某个项目的上下文里调')
  return cwd
}
const dataPath = (cwd) => path.join(cwd, '.eas', 'pomodoro.json')
function load(cwd) {
  try {
    const j = JSON.parse(fs.readFileSync(dataPath(cwd), 'utf8'))
    return {
      running: !!j.running,
      startedAt: Number(j.startedAt) || 0,
      minutes: Number(j.minutes) || 25,
      mode: j.mode === 'break' ? 'break' : 'focus',
      sessions: Array.isArray(j.sessions) ? j.sessions : []
    }
  } catch {
    return { running: false, startedAt: 0, minutes: 25, mode: 'focus', sessions: [] }
  }
}
function save(cwd, data) {
  const p = dataPath(cwd)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
}
function remainingSec(d) {
  if (!d.running) return 0
  const passed = Math.floor((Date.now() - d.startedAt) / 1000)
  return Math.max(0, d.minutes * 60 - passed)
}
function todayCount(sessions) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return sessions.filter((s) => s && s.mode === 'focus' && Number(s.at) >= start.getTime()).length
}
function view(d) {
  return {
    running: d.running,
    mode: d.mode,
    minutes: d.minutes,
    remaining: remainingSec(d),
    startedAt: d.startedAt,
    todayFocus: todayCount(d.sessions),
    totalFocus: d.sessions.filter((s) => s && s.mode === 'focus').length
  }
}

function call(name, args, params) {
  const cwd = cwdOf(params)
  const d = load(cwd)
  switch (name) {
    case 'pomodoro_show':
      return { ok: true, ...view(d), note: '面板已由宿主打开' }
    case 'pomodoro_status':
      return view(d)
    case 'pomodoro_start': {
      const mode = args.mode === 'break' ? 'break' : 'focus'
      let minutes = Number(args.minutes)
      if (!Number.isFinite(minutes) || minutes <= 0) minutes = MODES[mode]
      minutes = Math.min(180, Math.max(1, Math.round(minutes)))
      d.running = true
      d.startedAt = Date.now()
      d.minutes = minutes
      d.mode = mode
      save(cwd, d)
      return view(d)
    }
    case 'pomodoro_stop':
      d.running = false
      save(cwd, d)
      return view(d)
    case 'pomodoro_done': {
      // 记一笔完成的会话（只在确实在跑时记，避免重复调用刷记录）
      if (d.running) {
        d.sessions.push({ at: d.startedAt, minutes: d.minutes, mode: d.mode })
        if (d.sessions.length > 500) d.sessions = d.sessions.slice(-500)
      }
      d.running = false
      save(cwd, d)
      return view(d)
    }
    default:
      throw new Error(`未知工具 ${name}`)
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
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
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'pomodoro', version: '1.0.0' }
      })
    } else if (method?.startsWith('notifications/')) {
      // 通知无需响应
    } else if (method === 'tools/list') {
      ok(id, { tools: TOOLS })
    } else if (method === 'tools/call') {
      try {
        const data = call(params?.name, params?.arguments ?? {}, params)
        ok(id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data })
      } catch (e) {
        ok(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true })
      }
    } else if (method === 'resources/list') {
      ok(id, { resources: [{ uri: PANEL_URI, name: '番茄钟面板', mimeType: 'text/html;profile=mcp-app' }] })
    } else if (method === 'resources/read') {
      if (params?.uri !== PANEL_URI) return fail(id, -32602, `没有资源 ${params?.uri}`)
      const html = fs.readFileSync(path.join(HERE, 'ui', 'panel.html'), 'utf8')
      ok(id, { contents: [{ uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', text: html }] })
    } else if (method === 'ping') {
      ok(id, {})
    } else if (id !== undefined) {
      fail(id, -32601, `不支持的方法 ${method}`)
    }
  } catch (e) {
    if (id !== undefined) fail(id, -32603, String(e.message || e))
  }
})
