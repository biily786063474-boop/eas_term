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
    name: 'wiki_inbox',
    description:
      '列出用户知识库收件箱里待整理的文件（名字/大小/放进来多久）。要整理收件箱时先调它，别去 shell 里 ls。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wiki_lint',
    description:
      '给知识库做**结构体检**：死链、孤儿页、缺 summary/tags、index.md 漏收、长期没动过、内容过薄。' +
      '这些是免费瞬时算出来的，你不用自己扫全库。' +
      '拿到结果后再去做需要读懂内容的那半边——页面之间的矛盾、被新素材推翻的旧结论、' +
      '反复被提到却没有独立页面的概念。**只出报告，改什么由用户点头。**',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wiki_log',
    description:
      '往知识库的 log.md 追加一条记录。**每次你依据知识库回答完问题，都调一次 query**；' +
      '归档完调 ingest；体检完调 lint。' +
      '这既是知识库的时间线，也是判断「这东西有没有真被用起来」的唯一数据来源——' +
      '只往里放不去查，说明它没长成工具。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['ingest', 'query', 'lint'] },
        title: { type: 'string', description: '一句话说清这次干了什么／问了什么' }
      },
      required: ['action', 'title']
    }
  },
  {
    name: 'wiki_transcript',
    description:
      '读收件箱里某个视频/音频已经转好的逐字稿（本机离线转的，不花 token）。' +
      '整理这类素材时先调它拿内容，再决定归到哪、写成什么笔记。' +
      '返回 null 表示还没转完或转不出来（比如那个文件里没有音轨）。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '收件箱里的文件名' } },
      required: ['name']
    }
  },
  {
    name: 'wiki_archive_plan',
    description:
      '提交归档计划给用户过目，**等他在界面上确认**后返回他批准的条目。' +
      '这个调用会阻塞几十秒到几分钟（要等人点），是正常的。' +
      '规矩：先调 wiki_inbox 看有什么，再为每个文件想清楚归到哪、写成哪篇笔记，一次提交整批。' +
      '返回 approved 后：先把批准的文件用 wiki_archive_exec 搬到素材目录，再写笔记、更新 index.md 和 log.md。' +
      '用户没批准的条目不要动。',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '每个文件一条',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '收件箱里的文件名' },
              rename: { type: 'string', description: '归档后改成什么名字（可选）' },
              note: { type: 'string', description: '打算写成哪篇笔记，如 方法/三秒法则.md' },
              reason: { type: 'string', description: '一句话说明为什么这么归' }
            },
            required: ['name']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'wiki_archive_exec',
    description:
      '把用户批准的文件从收件箱搬到 素材/<年月>/。只移动不删除、重名自动加后缀。' +
      '**只搬文件，笔记要你自己写。** 返回每个文件的新路径，写 front-matter 的 source 字段时用它。',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, rename: { type: 'string' } },
            required: ['name']
          }
        }
      },
      required: ['items']
    }
  },
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
