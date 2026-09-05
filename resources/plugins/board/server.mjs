#!/usr/bin/env node
// 样板插件「看板」的 MCP server（stdio，零依赖）。
//
// 它只用两样东西：MCP（工具 + ui:// 资源）和面板桥。**没有任何 Eas-Term 内部 IPC** ——
// 拿到别的 MCP Apps 宿主里也能原样跑（设计稿决定 #9）。
//
// 数据：<cwd>/.eas/board.json。cwd 来自 tools/call 参数的 _meta.eas.context.cwd
// （面板那边由宿主注入，会话那边由转发 shim 从 EAS_PROJECT 注入）。**不猜 cwd**：拿不到就报错。
import readline from 'readline'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL_URI = 'ui://board/panel'
const COLS = ['todo', 'doing', 'done']

const TOOLS = [
  {
    name: 'board_show',
    description: '打开看板面板（三栏：待办 / 进行中 / 完成）',
    inputSchema: { type: 'object', properties: {} },
    _meta: { 'ui/resourceUri': PANEL_URI }
  },
  {
    name: 'board_list',
    description: '列出看板上所有卡片',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'board_add',
    description: '往看板加一张卡',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '卡片标题' },
        col: { type: 'string', enum: COLS, description: '放到哪一栏，默认 todo' },
        file: { type: 'string', description: '关联的文件路径（相对项目根），可选' }
      },
      required: ['title']
    }
  },
  {
    name: 'board_move',
    description: '把一张卡挪到另一栏',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, col: { type: 'string', enum: COLS } }, required: ['id', 'col'] }
  },
  {
    name: 'board_remove',
    description: '删掉一张卡',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  }
]

function cwdOf(params) {
  const cwd = params?._meta?.eas?.context?.cwd
  if (typeof cwd !== 'string' || !cwd) throw new Error('缺项目路径（_meta.eas.context.cwd）—— 这个工具要在某个项目的上下文里调')
  return cwd
}
function dataPath(cwd) {
  return path.join(cwd, '.eas', 'board.json')
}
function load(cwd) {
  try {
    const j = JSON.parse(fs.readFileSync(dataPath(cwd), 'utf8'))
    return Array.isArray(j.cards) ? j : { cards: [] }
  } catch {
    return { cards: [] }
  }
}
function save(cwd, data) {
  const p = dataPath(cwd)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
}
const uid = () => Math.random().toString(36).slice(2, 10)

function call(name, args, params) {
  const cwd = cwdOf(params)
  const data = load(cwd)
  switch (name) {
    case 'board_show':
      return { ok: true, cards: data.cards, note: '面板已由宿主打开' }
    case 'board_list':
      return { cards: data.cards }
    case 'board_add': {
      const title = String(args.title ?? '').trim()
      if (!title) throw new Error('title 不能为空')
      const col = COLS.includes(args.col) ? args.col : 'todo'
      const card = { id: uid(), title, col, file: typeof args.file === 'string' ? args.file : undefined, at: Date.now() }
      data.cards.push(card)
      save(cwd, data)
      return { card }
    }
    case 'board_move': {
      const c = data.cards.find((x) => x.id === args.id)
      if (!c) throw new Error(`没有卡片 ${args.id}`)
      if (!COLS.includes(args.col)) throw new Error(`col 只能是 ${COLS.join('/')}`)
      c.col = args.col
      save(cwd, data)
      return { card: c }
    }
    case 'board_remove': {
      const n = data.cards.length
      data.cards = data.cards.filter((x) => x.id !== args.id)
      if (data.cards.length === n) throw new Error(`没有卡片 ${args.id}`)
      save(cwd, data)
      return { removed: args.id }
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
        serverInfo: { name: 'board', version: '1.0.0' }
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
      ok(id, { resources: [{ uri: PANEL_URI, name: '看板面板', mimeType: 'text/html;profile=mcp-app' }] })
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
