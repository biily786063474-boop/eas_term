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
    name: 'wiki_query',
    description:
      '查用户的个人知识库(他自建的 markdown 笔记库)。**这个工具只在 Eas-Term 的终端里存在**——' +
      '你能看到它，本身就说明这条会话是在 Eas-Term 里起的，不用另外确认。' +
      '触发时机：用户问"怎么做"这类方法问题、提到某个博主/作者/人名、问过去做过的决定或踩过的坑、' +
      '要你产出带他个人风格的东西(简介/简历/自我介绍/选题/对外文案)、' +
      '或者他问"我该怎么做""我适合什么"这类关于他自己的问题时，先调这个工具。' +
      '也在他明说"查知识库""wiki 里有没有""整理收件箱""归档""做个体检"时调用。' +
      '返回全库索引(index.md 原文，每页一行摘要)、各分区在盘上的实际目录名(dirs)，' +
      '以及**可能有的** library 字段。' +
      '**返回里如果有 library 字段，说明用户自己定义了分类**：按它每一项的 name/purpose 判断东西该往哪放，' +
      '这种情况下**忽略 dirs**——dirs 固定是内置八目录的形状，自定义库里那些名字对应的目录根本不存在，' +
      '照着 dirs 写会凭空建出配置外的目录。library 里 role 为 "inbox" 或 "raw" 的目录放的是原件，只读不改。' +
      '**返回里如果是 taxonomyBroken:true**：这个库有自定义分类配置但读不出来（格式错/校验不过），' +
      '这时候**没有 dirs 也没有 library**——别按内置分类猜、更别照内置形状写笔记建目录，那会把这个' +
      '自定义库的结构写乱且不可逆。这个状态下不归档、不新建笔记、不建目录，用户问起就告诉他去把' +
      '.eas-wiki.json 改好；跟"用户压根没配置过库"是两回事，别当成同一种情况处理。' +
      '拿到后：自己从索引挑 1-3 篇相关的用 Read 读那几篇原文，回答时说明参考了哪几篇；' +
      '答完调一次 wiki_log(action=query)记一笔——这是判断这东西有没有真被用起来的唯一数据来源，不记的话查询数永远是 0。' +
      '**以下两条只在没有 library 字段时（内置分类的库）适用**：' +
      'dirs.me 是"关于用户本人"的分区(画像/工作习惯/方法论/决策偏好)，dirs.people 是"他研究的别人"，两者别混——' +
      '产出要带他个人风格、或他问关于自己的问题时，先看 dirs.me；dirs.me 是空的就直说还没建，别瞎猜他是谁。' +
      '索引里没有相关内容就直说没有，不要编。' +
      '整理收件箱走 wiki_inbox→wiki_transcript→想清楚归哪→wiki_archive_plan(等用户确认)→wiki_archive_exec→写笔记→wiki_log(action=ingest)，别跳步。' +
      '体检先调 wiki_lint 拿结构问题，再补读懂内容才能发现的那半边，只出报告不擅自改，完事 wiki_log(action=lint)。' +
      '返回里 dirs.sources 和 dirs.inbox(没有 library 字段时)指向的目录、或 library 里 role 为 ' +
      '"raw"/"inbox" 的目录(有 library 字段时)，里面的原始文件只读：可以移动改名，绝不改内容删除。' +
      '每篇笔记要有 front-matter 的 summary 和 tags，笔记间用 [[双链]] 互指。',
    inputSchema: { type: 'object', properties: {} }
  },
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
      '读取画板完整状态：每个 Frame 下所有模块的 node_id / 类型 / 标题 / 位置大小，以及当前终端所在的 Frame 和节点。' +
      '另有 freeNodes：不属于任何 Frame 的自由模块（用户从知识库拖出来的只读预览），同样有 node_id，聚焦/最大化/关闭/重命名对它们一样生效。' +
      '要操作某个模块之前先调它拿 node_id。' +
      '用户问的是「画板现在**看起来**什么样」时，先用 canvas_latest_snapshot 取图看 —— 这个工具只给结构。',
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
      '在 Frame 旁边贴一张批注（写结论/待办/提醒，留在画板上不会随对话滚走）。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '批注内容' },
        frame_id: { type: 'string', description: '不传则贴在当前终端所在的 Frame 右侧' },
        color: { type: 'string', description: '可选颜色（CSS 色值）' }
      },
      required: ['text']
    }
  },
  {
    name: 'canvas_snapshot',
    description:
      '拍一张当前画板的快照，存进选中工作区所属项目的 screenshot/ 下，返回图片路径。' +
      '**要求用户已经在画板上选中一个工作区** —— 没选中时会返回提示，' +
      '这时候要让用户先去画板上点一个工作区，不要自己猜一个项目。' +
      '返回里的 shapesCleared 是这次顺带清掉的标记数（用户设过「拍完清掉」才 >0），不为 0 要告诉用户一声。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'canvas_latest_snapshot',
    description:
      '取最新一张画板快照的路径。**用户问「画板现在什么样」「看看画布」这类问题时先用它** —— ' +
      'canvas_get_state 返回的是节点树（谁在哪、叫什么），回答不了「看起来怎么样」。' +
      '拿到路径后用 Read 看图。没有任何快照时会明说没有，那时候可以建议用户拍一张。',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: '项目路径；不给就用当前活动项目' } }
    }
  },
  // ── 密钥柜三件套 ───────────────────────────────────────────────────
  // **这三个 description 是常驻成本**：每个会话的 tools/list 都要发一遍，
  // 不管这次用不用得上密钥。所以这里只写「什么时候调」，一个字的「怎么做」都不写 ——
  // 详细约定（成对凭证要一次写全、存完当前终端读不到、怎么用、红线是什么）
  // 全部放在**返回值和错误信息**里，只有真的走到密钥场景的会话才付那份 token。
  // 同一条纪律见 src/main/agentRules.ts 开头：常驻区只放触发条件，正文按需读。
  {
    name: 'secret_check',
    description:
      '开跑之前查这些环境变量有没有（缺 key 时先问它，别直接向用户要）。只回有/没有，不回值。',
    inputSchema: {
      type: 'object',
      properties: {
        vars: { type: 'array', description: '要查的环境变量名', items: { type: 'string' } }
      },
      required: ['vars']
    }
  },
  {
    name: 'request_secret',
    description:
      '缺 API key / 凭证时调它，弹 GUI 让用户自己填。**不要让用户把密钥贴进对话。**',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '这组凭证叫什么，给人看的（例：AWS 生产账号）' },
        vars: {
          type: 'array',
          description: '要哪些环境变量名。成对的凭证（AK/SK、user/password）一次全写上',
          items: { type: 'string' }
        },
        purpose: { type: 'string', description: '要来干什么，一句人话。会原样显示给用户' },
        docs_url: { type: 'string', description: '去哪申请（可选，只接受 http/https）' }
      },
      required: ['name', 'vars', 'purpose']
    }
  },
  {
    name: 'report_secret_invalid',
    description:
      '用了密钥柜里的凭证但服务说它无效（401/403）时调它，让用户去改。**别向用户要明文核对。**',
    inputSchema: {
      type: 'object',
      properties: {
        vars: { type: 'array', description: '哪些变量看起来不对', items: { type: 'string' } },
        detail: { type: 'string', description: '服务返回的原话，让用户好判断（别编）' }
      },
      required: ['vars', 'detail']
    }
  },
  {
    name: 'dict_pending',
    description:
      '列出「提交即复盘」钩子扫出来、等你补全的术语。' +
      '收到 [词典·待补全] 提示但没记全是哪几个词时调它。返回空数组就是没有待办，别自己找活干。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'dict_add',
    description:
      '往用户的名词词典里添加词条。**格式必须和内置的 242 条完全一致**，缺字段会被拒收——' +
      '半截词条（只有英文名、没解释没图）混进去既帮不上忙又稀释整本词典的可信度。' +
      '每条都要:中文名 + 英文名 + 三选一的分类 + 80-140 字讲清怎么实现的解释 + 一张 240x120 的极简示意 SVG。' +
      '拿不准的词直接跳过，宁缺毋滥。返回里会说明哪些被拒、为什么。',
    inputSchema: {
      type: 'object',
      properties: {
        terms: {
          type: 'array',
          description: '一次提交整批，别一个一个调',
          items: {
            type: 'object',
            properties: {
              en: { type: 'string', description: '英文原名，如 scroll-snap-type' },
              zh: { type: 'string', description: '中文名，如「滚动吸附」' },
              category: {
                type: 'string',
                enum: ['interaction', 'motion', 'visual'],
                description: 'interaction=交互行为，motion=动效，visual=UI视觉。不另开分类'
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: '检索词，中英文都放，用户搜哪个都能命中'
              },
              logic: {
                type: 'string',
                description:
                  '80-140 字中文单行：它是什么、怎么实现的。写给「知道这个效果但不知道叫什么」的人看，不要同义反复'
              },
              svg: {
                type: 'string',
                description:
                  '示意图，一个完整的 <svg> 元素：viewBox="0 0 240 120"，font-family="sans-serif"，' +
                  '标注文字 #8a8f99、强调 #e0a45e、输出/结果 #6ea8fe。' +
                  '禁止 script / 事件属性 / 外链 / foreignObject（会被清洗掉）'
              }
            },
            required: ['en', 'zh', 'category', 'logic']
          }
        }
      },
      required: ['terms']
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
