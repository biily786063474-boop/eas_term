#!/usr/bin/env node
// Eas-Term 的 MCP Server（stdio，零依赖手写 JSON-RPC）。
//
// 由跑在 Eas-Term 终端里的 Claude Code / Codex 启动：
//   环境变量 EAS_TERM_PORT / EAS_TERM_TOKEN / EAS_PTY_ID / EAS_PROJECT 由 app 的 PTY 自动注入，
//   所以工具调用天然知道「我在哪个终端 → 属于哪个 Frame」，不需要 AI 指定。
//
// 传输：MCP stdio = 一行一条 JSON-RPC 消息（换行分隔），响应写 stdout。

import readline from 'readline'

const PORT = process.env.EAS_TERM_PORT
const TOKEN = process.env.EAS_TERM_TOKEN
const CTX = { ptyId: process.env.EAS_PTY_ID, project: process.env.EAS_PROJECT }

const TOOLS = [
  {
    name: 'canvas_open_html',
    description:
      '把一个本地 HTML 文件在 Eas-Term 画板里打开成浏览器节点并聚焦。产出报告/预览页后调它，用户抬头就能看到。路径可用相对项目根的路径。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'HTML 文件路径（相对项目根或绝对路径）' } },
      required: ['path']
    }
  },
  {
    name: 'canvas_open_file',
    description:
      '在画板里打开一个文件的预览节点：代码/Markdown 走代码预览，图片/视频走媒体预览，HTML 走浏览器。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '文件路径（相对项目根或绝对路径）' } },
      required: ['path']
    }
  },
  {
    name: 'canvas_open_url',
    description: '在画板里打开一个网址（内嵌 Chromium 浏览器节点），用于查文档或看部署结果。',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http(s) 网址' } },
      required: ['url']
    }
  },
  {
    name: 'notify',
    description:
      '给用户发一条「需要处理」提醒（标题栏铃铛 + 项目徽标）。任务跑完或需要用户确认时调用，用户在别处干活也能看到。',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: '提醒内容' } },
      required: ['message']
    }
  },
  {
    name: 'canvas_list_frames',
    description: '列出画板上的所有 Frame（id / 名称 / 所属项目 / 模块数），并标出当前终端所在的 Frame。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'canvas_get_state',
    description:
      '读取画板完整状态：每个 Frame 下所有模块的 node_id / 类型 / 标题 / 位置大小，以及当前终端所在的 Frame 和节点。要操作某个模块（聚焦/最大化/关闭/重命名）之前先调它拿 node_id。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'canvas_focus_node',
    description: '把画板视口移到某个模块并选中它（用户注意力引过去）。node_id 来自 canvas_get_state。',
    inputSchema: {
      type: 'object',
      properties: { node_id: { type: 'string', description: '模块 id' } },
      required: ['node_id']
    }
  },
  {
    name: 'canvas_maximize_node',
    description:
      '把某个模块最大化成沉浸视图（铺满画布），适合让用户仔细看某个预览；传 restore=true 则还原回画布。',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '要最大化的模块 id' },
        restore: { type: 'boolean', description: '传 true 表示还原（此时不用给 node_id）' }
      }
    }
  },
  {
    name: 'canvas_close_node',
    description:
      '关掉一个模块（清理自己开出来的预览/浏览器节点）。注意：终端节点不允许关，会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: { node_id: { type: 'string', description: '模块 id' } },
      required: ['node_id']
    }
  },
  {
    name: 'canvas_rename_node',
    description: '给模块改个有意义的名字（比如把浏览器节点改成「性能报告」），方便用户在缩略图里认出来。',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '模块 id' },
        name: { type: 'string', description: '新名称' }
      },
      required: ['node_id', 'name']
    }
  },
  {
    name: 'canvas_tidy_frame',
    description: '一键整理 Frame 内的模块：按各自大小从左上角起流式重排，消除重叠和空隙。开了一堆预览之后调它收拾干净。',
    inputSchema: {
      type: 'object',
      properties: { frame_id: { type: 'string', description: '不传则整理当前终端所在的 Frame' } }
    }
  },
  {
    name: 'canvas_new_terminal',
    description:
      '在 Frame 里新开一个终端模块（只开，不代替用户输入命令）。适合「这步需要你亲自跑一下」的场景。',
    inputSchema: {
      type: 'object',
      properties: { frame_id: { type: 'string', description: '不传则开在当前终端所在的 Frame' } }
    }
  },
  {
    name: 'canvas_add_note',
    description:
      '在 Frame 旁边贴一张便签（写结论/待办/提醒，留在画板上不会随对话滚走）。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '便签内容' },
        frame_id: { type: 'string', description: '不传则贴在当前终端所在的 Frame 右侧' },
        color: { type: 'string', description: '可选颜色（CSS 色值）' }
      },
      required: ['text']
    }
  }
]

async function callApp(tool, args) {
  if (!PORT || !TOKEN) {
    throw new Error('未检测到 Eas-Term 环境（EAS_TERM_PORT/TOKEN 缺失）——请在 Eas-Term 的终端里运行')
  }
  const res = await fetch(`http://127.0.0.1:${PORT}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eas-token': TOKEN },
    body: JSON.stringify({ tool, args, ctx: CTX })
  })
  const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
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
      ok(id, { tools: TOOLS })
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
