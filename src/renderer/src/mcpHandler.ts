// MCP 工具执行器（渲染层）：主进程把 AI 的调用转过来，这里落到 store action 再回结果。
//
// 上下文自动解析：调用方终端的 ptyId（PTY env 注入）→ 反查它挂在哪个 Frame / 哪个节点，
// 所以 AI 调 canvas_open_html 时不用指定 frame，产出直接开在「它自己所在的那个 Frame」里。
import { useStore } from './store'
import { collectLeaves } from './layout'
import { fileUrlOf, isWebFile } from './store/shared'
import type { CanvasFrame, CanvasNode } from './store/canvasSlice'
import type { PaneState } from './layout'
import type { ArchiveItem } from '../../shared/types'
import { askForSecret } from './features/workspace/secretRequest'
import { liveMaximizedNode } from './store/canvas/selectors'

interface Ctx {
  ptyId?: string
  project?: string
}

// ptyId → 它所属的画布 Frame / 节点；找不到就回落到「当前项目的顶层 Frame」
function resolveFrame(ctx: Ctx): { frameId: string; nodeId?: string; projectPath: string } | null {
  const s = useStore.getState()
  if (ctx.ptyId) {
    for (const t of s.tabs) {
      const leaf = collectLeaves(t.root).find(
        (l) => l.pane.kind === 'terminal' && l.pane.ptyId === ctx.ptyId
      )
      if (!leaf) continue
      for (const f of s.canvas.frames) {
        const n = f.nodes.find((x) => x.leafId === leaf.id)
        if (n) {
          const proj = s.projects.find((p) => p.id === f.projectId)
          return { frameId: f.id, nodeId: n.id, projectPath: proj?.path ?? ctx.project ?? '' }
        }
      }
    }
  }
  const fallback =
    s.canvas.frames.find((f) => !f.parentId && f.projectId === s.activeProjectId) ??
    s.canvas.frames.find((f) => !f.parentId)
  if (!fallback) return null
  const proj = s.projects.find((p) => p.id === fallback.projectId)
  return { frameId: fallback.id, projectPath: proj?.path ?? ctx.project ?? '' }
}

// 路径白名单：只允许项目目录内（防止把 ~/.ssh/id_rsa 之类渲染出来）
function safePath(input: string, projectPath: string, ctxProject?: string): string {
  // 基准优先取调用方自己的项目/cwd（AI 说的相对路径是相对它自己），其次才是目标 Frame 的项目
  const base = ctxProject || projectPath || ''
  let abs = input
  if (!input.startsWith('/')) {
    if (!base) throw new Error('相对路径需要项目上下文')
    abs = base.replace(/\/$/, '') + '/' + input.replace(/^\.\//, '')
  }
  // 规范化 .. 后再判定归属
  const parts: string[] = []
  for (const seg of abs.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  const norm = '/' + parts.join('/')
  // 允许范围：调用方项目 与 目标 Frame 项目 都算合法（AI 可能把产出开到另一个项目的 Frame）
  // 去重：终端在自己项目的 Frame 里时两者相同，不去重的话越界报错会把同一路径打印两遍
  const allows = [
    ...new Set([ctxProject, projectPath].filter(Boolean).map((x) => x!.replace(/\/$/, '')))
  ]
  const allow = allows.find((a) => norm === a || norm.startsWith(a + '/')) ?? ''
  if (!allow) {
    throw new Error(`路径越界，只允许项目目录内：${allows.join(' 或 ') || '(未知项目)'}`)
  }
  return norm
}

// nodeId 全局唯一（uid('cnode')），所以 AI 只用给 node_id，不必再指定 frame。
// frame:null 表示这是个自由节点（不属于任何 Frame，用户从知识库拖出来的只读预览）。
function findNode(nodeId: string): { frame: CanvasFrame | null; node: CanvasNode } | null {
  for (const f of useStore.getState().canvas.frames) {
    const node = f.nodes.find((n) => n.id === nodeId)
    if (node) return { frame: f, node }
  }
  const free = useStore.getState().canvas.freeNodes.find((n) => n.id === nodeId)
  return free ? { frame: null, node: free } : null
}

// 按 leafId 取当前 pane：终端节点可能已被切成图片/代码/网页，kind 得看实时 pane
function paneOfLeaf(leafId: string): PaneState | undefined {
  for (const t of useStore.getState().tabs) {
    const leaf = collectLeaves(t.root).find((l) => l.id === leafId)
    if (leaf) return leaf.pane
  }
  return undefined
}

// 给 AI 看的节点描述：类型 + 可读标题（它据此决定聚焦/关闭谁）
function describeNode(n: CanvasNode): Record<string, unknown> {
  let kind = 'unknown'
  let title = n.name ?? ''
  if (n.leafId) {
    kind = 'terminal'
    const pane = paneOfLeaf(n.leafId)
    if (pane && pane.kind !== 'terminal') kind = pane.kind
    if (!title) title = kind === 'terminal' ? '终端' : ''
  } else if (n.component) {
    kind = 'component:' + n.component.type
  } else if (n.pane) {
    kind = n.pane.kind
    if (!title) {
      const p = n.pane as { filePath?: string; url?: string | null; title?: string }
      title = p.title || p.filePath?.split('/').pop() || p.url || ''
    }
  }
  return { id: n.id, kind, title, x: n.x, y: n.y, w: n.w, h: n.h }
}

type Args = Record<string, unknown>

async function runTool(tool: string, args: Args, ctx: Ctx): Promise<unknown> {
  const s = useStore.getState()

  if (tool === 'canvas_get_state') {
    const cur = resolveFrame(ctx)
    return {
      viewMode: s.viewMode,
      maximized: liveMaximizedNode(s)?.nodeId ?? null,
      currentFrameId: cur?.frameId ?? null,
      currentNodeId: cur?.nodeId ?? null,
      frames: s.canvas.frames.map((f) => ({
        id: f.id,
        name: f.name,
        isSub: !!f.parentId,
        collapsed: f.collapsed,
        project: s.projects.find((p) => p.id === f.projectId)?.path ?? null,
        nodes: f.nodes.map(describeNode)
      })),
      // 不属于任何 Frame 的自由模块（用户从知识库拖出来的只读预览）；node_id 一样能聚焦/最大化/关闭/重命名
      freeNodes: s.canvas.freeNodes.map(describeNode)
    }
  }

  if (tool === 'canvas_focus_node' || tool === 'canvas_maximize_node' || tool === 'canvas_close_node' || tool === 'canvas_rename_node') {
    // 还原最大化不需要 node_id
    if (tool === 'canvas_maximize_node' && args.restore) {
      s.setMaximizedNode(null)
      return { restored: true }
    }
    const nodeId = String(args.node_id ?? '')
    if (!nodeId) throw new Error('缺少 node_id（先用 canvas_get_state 查）')
    const hit = findNode(nodeId)
    if (!hit) throw new Error(`找不到节点 ${nodeId}`)
    if (s.viewMode !== 'canvas') s.setViewMode('canvas')
    const frameId = hit.frame?.id // undefined = 自由节点

    if (tool === 'canvas_focus_node') {
      if (frameId) s.focusCanvasNode(frameId, nodeId)
      else s.focusFreeNode(nodeId)
      return { focused: nodeId, frameId: frameId ?? null }
    }
    if (tool === 'canvas_maximize_node') {
      s.setMaximizedNode(frameId ? { frameId, nodeId } : { nodeId })
      return { maximized: nodeId }
    }
    if (tool === 'canvas_rename_node') {
      const name = String(args.name ?? '').trim()
      if (!name) throw new Error('缺少 name')
      if (frameId) s.renameNode(frameId, nodeId, name)
      else s.renameFreeNode(nodeId, name)
      return { renamed: nodeId, name }
    }
    // canvas_close_node：终端一律不给关（自由节点不可能是终端，天然跳过这条）。
    // AI 判断不了里面有没有在跑的活，关错代价太大（用户已因误删终端吃过亏）
    if (hit.node.leafId) {
      const pane = paneOfLeaf(hit.node.leafId)
      if (!pane || pane.kind === 'terminal') {
        throw new Error('终端节点不允许由 AI 关闭，请让用户手动关')
      }
    }
    if (frameId) s.removeNode(frameId, nodeId)
    else s.removeFreeNode(nodeId)
    return { closed: nodeId }
  }

  if (tool === 'canvas_tidy_frame' || tool === 'canvas_new_terminal' || tool === 'canvas_add_note') {
    const loc = resolveFrame(ctx)
    const frameId = String(args.frame_id ?? '') || loc?.frameId
    if (!frameId) throw new Error('画布里还没有 Frame')
    const frame = s.canvas.frames.find((f) => f.id === frameId)
    if (!frame) throw new Error(`找不到 Frame ${frameId}`)
    if (s.viewMode !== 'canvas') s.setViewMode('canvas')

    if (tool === 'canvas_tidy_frame') {
      s.tidyFrame(frameId)
      return { tidied: frameId, nodes: frame.nodes.length }
    }
    if (tool === 'canvas_new_terminal') {
      await s.addTerminalNode(frameId)
      const after = useStore.getState().canvas.frames.find((f) => f.id === frameId)
      const added = after?.nodes[after.nodes.length - 1]
      return { opened: added?.id ?? null, frameId }
    }
    // 便签贴在 Frame 右侧外，已有的往下顺延，不互相盖
    const text = String(args.text ?? '').trim()
    if (!text) throw new Error('缺少 text')
    const nx = frame.x + frame.w + 24
    let ny = frame.y
    while (s.canvas.shapes.some((sh) => Math.abs(sh.x - nx) < 8 && Math.abs(sh.y - ny) < 8)) ny += 110
    s.addShape({ type: 'sticky', x: nx, y: ny, w: 190, h: 96, text, color: String(args.color ?? '') || undefined })
    return { noted: text, at: { x: nx, y: ny } }
  }

  if (tool === 'canvas_list_frames') {
    return {
      frames: s.canvas.frames.map((f) => ({
        id: f.id,
        name: f.name,
        isSub: !!f.parentId,
        project: s.projects.find((p) => p.id === f.projectId)?.name ?? null,
        nodes: f.nodes.length
      })),
      current: resolveFrame(ctx)?.frameId ?? null
    }
  }

  if (tool === 'notify') {
    const msg = String(args.message ?? '')
    const loc = resolveFrame(ctx)
    // 复用「任务完成」提醒：标题栏铃铛 + Sidebar 项目徽标 + 画布抽屉呼吸点
    const leafIds = new Set(
      s.canvas.frames
        .find((f) => f.id === loc?.frameId)
        ?.nodes.map((n) => n.leafId)
        .filter(Boolean) as string[]
    )
    let flagged = 0
    for (const t of s.tabs) {
      for (const l of collectLeaves(t.root)) {
        if (l.pane.kind !== 'terminal') continue
        if (ctx.ptyId ? l.pane.ptyId === ctx.ptyId : leafIds.has(l.id)) {
          s.flagAttention(l.pane.ptyId)
          flagged++
        }
      }
    }
    return { notified: flagged > 0, message: msg }
  }

/**
 * 这段警告必须跟着每一条「用 eas-secret 跑」的指引走。
 *
 * 实测过的坑：当前终端里没有这个变量（这正是要用 eas-secret 的场景），
 * agent 照抄 `-- curl -H "Bearer $API_KEY"` 时，**外层 shell 会先把 $API_KEY 吃成空**，
 * 子命令收到的是 `Bearer `，服务返 401，agent 于是严格按指引调 report_secret_invalid，
 * 用户被要求重填一个完全正确的 key —— 唯一一条会让用户认定「这功能是坏的」的路径。
 * 值只在子进程里存在，所以引用它的那一层必须是子进程自己的 shell。
 */
const SHELL_TRAP =
  `值只在被包裹的那条命令里存在。**命令里如果要引用 $变量，必须让子进程自己展开**：\n` +
  `  对的：eas-secret run --vars API_KEY -- sh -c 'curl -H "Authorization: Bearer $API_KEY" ...'\n` +
  `  错的：eas-secret run --vars API_KEY -- sh -c "curl -H \\"Bearer $API_KEY\\" ..."  ← 双引号会被外层 shell 先吃掉，变成空\n` +
  `命令自己读环境变量的（aws / gh / docker 这类）直接写就行，不用管这条。`

// ── 密钥柜三件套 ──
  //
  // **详细规则全在这三个分支的返回值里，不在工具 description 里。**
  // description 是常驻成本（每个会话的 tools/list 都要发一遍，不管用不用得上密钥），
  // 返回值只有真的走到密钥场景才付。所以那边只留一句触发条件，
  // 「怎么做、红线是什么、下一步」这些字全部放在这儿按需给。
  if (tool === 'secret_check') {
    const vars = (Array.isArray(args.vars) ? args.vars : []).map((v) => String(v ?? '').trim()).filter(Boolean)
    if (!vars.length) throw new Error('vars 必填：要查哪些环境变量名')
    const r = await window.api.secrets.has(vars, ctx.ptyId)
    const ready = r.vars.filter((v) => v.inThisTerminal).map((v) => v.varName)
    const inVaultOnly = r.vars.filter((v) => v.inVault && !v.inThisTerminal)
    const missing = r.vars.filter((v) => !v.inVault).map((v) => v.varName)
    const broken = r.vars.filter((v) => v.inVault && !v.readable).map((v) => v.varName)

    // 指引按情况给，能不给就不给 —— 全都齐了的时候只回一个字段
    let next: string
    if (missing.length) {
      next =
        `密钥柜里没有 ${missing.join('、')}。\n` +
        // 存量用户绝大多数把 key export 在 .zshrc 里，那种情况密钥柜是空的但终端里其实有。
        // 不给这条自查，agent 就会去弹窗要一个用户早就配好的 key。
        `先确认一下是不是用户自己在 shell 配置里配过（这条不会打印值）：\n` +
        `  sh -c 'test -n "$${missing[0]}" && echo HAVE || echo NONE'\n` +
        `真没有的话用 request_secret 弹 GUI 让用户填 —— ` +
        '**别让他把密钥贴进对话**（会永久留在会话记录里，也会上行到模型那边），' +
        '也别去 cat .env / 翻配置文件找。成对的凭证一次把 vars 写全。'
    } else if (broken.length) {
      next = `${broken.join('、')} 在这台机器上解不开（密钥库可能是从别的机器同步来的），让用户重新录入。`
    } else if (inVaultOnly.length) {
      const g = r.groups[0]
      next =
        `柜里有，但**你这个终端启动时没带上它**（进程的环境变量在启动那一刻就定死了）。` +
        `不用开新终端，用包装命令直接跑：\n` +
        `  eas-secret run --vars ${inVaultOnly.map((v) => v.varName).join(',')} -- <你原本要跑的命令>\n` +
        SHELL_TRAP +
        (r.locked ? '\n另外密钥柜现在锁着，让用户点标题栏的钥匙图标解锁后再跑。' : '')
    } else {
      next = '都能直接用，照常跑。'
    }
    return {
      // ready 的含义是「现在就能直接写 $VAR」，所以必须是**全都注入到本终端**。
      // 原来写成「柜里有就 true」，于是会出现 ready:true 配 inThisTerminal:[] 的自相矛盾，
      // agent 照着 ready 直接用变量，拿到空值。
      ready: r.vars.length > 0 && r.vars.every((v) => v.inThisTerminal),
      inVault: !missing.length && !broken.length,
      inThisTerminal: ready,
      needsWrapper: inVaultOnly.map((v) => v.varName),
      missing,
      next
    }
  }

  if (tool === 'report_secret_invalid') {
    const vars = (Array.isArray(args.vars) ? args.vars : []).map((v) => String(v ?? '').trim()).filter(Boolean)
    const detail = String(args.detail ?? '').trim()
    if (!vars.length) throw new Error('vars 必填：哪些变量看起来不对')
    if (!detail) throw new Error('detail 必填：把服务返回的原话贴上，用户要靠它判断')
    const r = await askForSecret(
      {
        name: `修正：${vars.join('、')}`,
        vars,
        purpose: detail,
        mode: 'fix'
      },
      ctx.ptyId
    )
    if (!r.saved) return { updated: false, reason: r.reason ?? '用户没有修改' }
    if (r.group) await window.api.secrets.grantToPty(ctx.ptyId, r.group)
    return {
      updated: true,
      vars: r.vars,
      next:
        `用户改过了。新值同样不会给你 —— 重跑刚才那条命令验证。\n` +
        `**当前终端 env 里还是旧值**（进程启动时就定死了），必须走包装命令才拿得到新的：\n` +
        `  eas-secret run --vars ${vars.join(',')} -- <刚才那条命令>\n` +
        SHELL_TRAP
    }
  }

  // ── AI 索要密钥：弹 GUI 让用户自己填，值不经 AI ──
  if (tool === 'request_secret') {
    const name = String(args.name ?? '').trim()
    const purpose = String(args.purpose ?? '').trim()
    const rawVars = Array.isArray(args.vars) ? args.vars : []
    const vars = rawVars.map((v) => String(v ?? '').trim()).filter(Boolean)
    if (!name) throw new Error('name 必填：这组凭证叫什么（例：AWS 生产账号）')
    if (!purpose) throw new Error('purpose 必填：说清你要它干什么，用户要靠这句话判断该不该给')
    if (!vars.length) throw new Error('vars 必填：要哪些环境变量名（AK/SK 这类成对的一次都写上）')
    // 变量名先在这儿卡一道，别等用户填完值了才报错
    const bad = vars.find((v) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))
    if (bad) throw new Error(`「${bad}」不是合法环境变量名：只能用字母数字下划线，且不能以数字开头`)
    // 链接是 AI 给的，只放行 http(s)，免得变成一条任意 URL 的执行通道
    const docsUrl = /^https?:\/\//i.test(String(args.docs_url ?? '')) ? String(args.docs_url) : undefined

    // askForSecret 抛异常 = 压根没弹（限流/已有一个在等），要让 AI 明确知道而不是干等
    const r = await askForSecret({ name, vars, purpose, docsUrl }, ctx.ptyId)
    if (!r.saved) return { saved: false, reason: r.reason ?? '用户没有提供' }
    // 用户当场把这组给了这个终端 → 授权它用 eas-secret 取。
    // 少了这一步最荒唐：刚填的密钥反而是唯一取不到的（新组不在任何终端的默认授权里）
    await window.api.secrets.grantToPty(ctx.ptyId, name)
    return {
      saved: true,
      vars: r.vars,
      // 这句必须有：当前终端的 env 在 spawn 那一刻就定死了，改不了。
      // 不说清楚的话 AI 会立刻去读 $VAR，读到空值然后开始瞎猜。
      // 这段指引必须有：当前终端的 env 在 spawn 那刻就定死了，改不了。
      // 不说清楚的话 AI 会立刻去读 $VAR，读到空值然后开始瞎猜，
      // 最后多半绕回「你把 key 贴给我吧」—— 那就白做了。
      next:
        `已存好。**当前这个终端读不到它**（进程的环境变量在启动那一刻就定死了）。` +
        `不用开新终端，直接用包装命令跑：\n` +
        `  eas-secret run --vars ${vars.join(',')} -- <你原本要跑的命令>\n` +
        SHELL_TRAP +
        `\n别去 echo/cat 这些变量 —— 打印出来它就进对话记录了，这个功能就白做了。` +
        (r.autoInject ? '' : '\n（用户没开自动注入，所以以后新开的终端也不会自动带上它）')
    }
  }

  // ── 知识库查询：内容离开本机进程边界的唯一通道，见 preload wiki.query 的注释 ──
  if (tool === 'wiki_query') {
    const r = await window.api.wiki.query()
    if (!r.configured) return { configured: false, hint: '用户还没配置知识库，不用做任何事，也别主动建议他去建一个' }
    // 库有自定义分类配置，但读不出来——不能落进下面「正常返回」那支：这里没有 dirs/
    // library，是刻意的，别去猜内置分类长什么样、更别照内置形状写笔记或建目录，
    // 那会把这个自定义库的目录结构写乱，而且不可逆。
    if (r.taxonomyBroken) {
      return {
        configured: true,
        hint:
          '这个知识库有自定义分类配置（.eas-wiki.json），但现在读不出来' +
          (r.taxonomyError ? `（${r.taxonomyError}）` : '') +
          '。别按内置分类猜——me/people/methods 这些目录在这个库里大概率不存在，写进去会把库的结构写乱且不可逆。' +
          '这个状态下什么都别做：不要归档、不要新建笔记、不要建目录。用户问起就告诉他去把 .eas-wiki.json 改好，改好后再查一次就恢复了。'
      }
    }
    if (!r.exists || r.looksEmpty) {
      return {
        configured: true,
        exists: r.exists,
        looksEmpty: r.looksEmpty,
        hint: r.looksEmpty
          ? '目录存在但读不到里面的内容，可能是指错了位置，也可能是权限/挂载问题——别猜内容，直接告诉用户这个情况'
          : '上次设的位置现在找不到了，可能被移走或网络盘没挂上'
      }
    }
    return {
      path: r.path,
      dirs: r.dirs,
      library: r.library,
      index: r.index,
      hint:
        'index 是全库摘要，挑 1-3 篇相关的用 Read 读那几篇原文，回答注明出处，答完调一次 wiki_log(action=query)。' +
        (r.library
          ? '这个库的分类是用户自定义的（见 library 字段）：按 library 每项的 name/purpose 判断东西该往哪放，' +
            '忽略 dirs——dirs 是内置分类的形状，在这个库里不存在。library 里 role 为 "inbox"/"raw" 的目录放的是原件，只读不改。'
          : '产出要带用户个人风格、或他问关于自己的问题时，先看 dirs.me（和 dirs.people 别混，那是他研究的别人）。')
    }
  }

  // ── 知识库归档 ────────────────────────────────────────────────
  if (tool === 'wiki_inbox') {
    const items = await window.api.wiki.inbox()
    const now = Date.now()
    // 配置坏掉时 window.api.wiki.inbox() 读的是内置回落算出来的目录名，对这个自定义库
    // 大概率是错的（真实收件箱叫别的名字）——这份列表很可能是空的或不完整，但那不代表
    // 收件箱真的空/干净。不查一下会让 agent 自信地告诉用户「没什么可整理的」，
    // 而用户真实的收件箱可能堆着一堆——这正是这个库最核心的功能被"看起来空了"污染。
    const st = await window.api.wiki.status()
    if (st.taxonomyState === 'broken') {
      return {
        items: items.map((x) => ({ name: x.name, size: x.size, days: Math.floor((now - x.at) / 86400000) })),
        hint:
          '这个知识库的分类配置读不出来，上面这份列表按的是猜出来的位置，很可能不是用户真实的收件箱——' +
          '不要说"收件箱是空的"或据此下结论，先让用户去把 .eas-wiki.json 改好。'
      }
    }
    return {
      items: items.map((x) => ({
        name: x.name,
        size: x.size,
        days: Math.floor((now - x.at) / 86400000)
      }))
    }
  }

  if (tool === 'wiki_lint') {
    const findings = await window.api.wiki.lint()
    return {
      findings,
      total: findings.length,
      hint:
        '以上只是结构问题。还需要你读内容才能发现的：页面之间的矛盾、被新素材推翻的旧结论、' +
        '反复出现却没有独立页面的概念。只出报告，别自动改。'
    }
  }

  if (tool === 'wiki_log') {
    const action = String(args.action ?? 'query') as 'ingest' | 'query' | 'lint'
    const r = await window.api.wiki.log(action, String(args.title ?? ''))
    return { ok: r.ok }
  }

  if (tool === 'wiki_transcript') {
    const name = String(args.name ?? '')
    if (!name) throw new Error('缺少 name')
    const text = await window.api.wiki.transcript(name)
    return text ? { name, text } : { name, text: null, hint: '还没转完，或者这个文件里没有可识别的音轨' }
  }

  if (tool === 'wiki_archive_plan') {
    const raw = Array.isArray(args.items) ? (args.items as ArchiveItem[]) : []
    const items = raw
      .map((x) => ({
        name: String(x?.name ?? '').trim(),
        rename: x?.rename ? String(x.rename) : undefined,
        note: x?.note ? String(x.note) : undefined,
        reason: x?.reason ? String(x.reason) : undefined
      }))
      .filter((x) => x.name)
    if (!items.length) throw new Error('计划是空的')
    // 落点检查提前到这里：自定义库没有 role:"raw" 目录时，以前要等到 wiki_archive_exec
    // 才会失败——用户已经走完一遍确认流程、点了「同意移动我的文件」才被告知没法归档。
    // 提前查一遍，没有落点直接报错，不让用户白点这一遍。
    const dirCheck = await window.api.wiki.archiveDirCheck()
    if (!dirCheck.ok) throw new Error(dirCheck.error ?? '没有可归档的目录')
    // 阻塞等用户在界面上过目。这是整个第 2 期的安全核心：
    // 失败模式不是「分类不准」，是「我那个文件去哪了」——发生一次就再没人敢往里放东西
    const approved = await s.requestArchivePlan(items)
    if (!approved) return { approved: [], cancelled: true, hint: '用户取消了这次归档，什么都没动。' }
    return {
      approved,
      hint: '用户批准了这些。接下来：先调 wiki_archive_exec 搬文件，再写笔记、更新 index.md 和 log.md。'
    }
  }

  if (tool === 'wiki_archive_exec') {
    const raw = Array.isArray(args.items) ? (args.items as ArchiveItem[]) : []
    const r = await window.api.wiki.archive(raw)
    if (!r.ok) throw new Error(r.error ?? '归档失败')
    return { moved: r.moved, failed: r.failed }
  }

  if (tool === 'dict_pending') {
    const items = await window.api.dict.pending()
    return {
      pending: items.map((x) => ({ name: x.name, project: x.project })),
      total: items.length,
      hint: items.length
        ? '为每个词写完整条目后一次性调 dict_add 提交。拿不准的跳过，宁缺毋滥。'
        : '没有待补全的术语，不用做任何事。'
    }
  }

  if (tool === 'dict_add') {
    const list = Array.isArray((args as { terms?: unknown }).terms)
      ? ((args as { terms: unknown[] }).terms as unknown[])
      : []
    if (!list.length) throw new Error('terms 是空的')
    const r = await window.api.dict.add(list)
    // 被拒的原样回给模型，让它知道差在哪、能补一次；不然它只会以为写成功了
    return {
      added: r.added,
      rejected: r.rejected,
      hint: r.rejected.length
        ? '被拒的条目按 why 改好再提交一次。改不出来就跳过，不要硬凑。'
        : '写完了，在回复最末尾用一行提一句即可。'
    }
  }

  // 以下工具都要落到某个 Frame
  const loc = resolveFrame(ctx)
  if (!loc) throw new Error('画布里还没有 Frame，无法打开预览')

  if (tool === 'canvas_open_url') {
    const url = String(args.url ?? '')
    if (!/^https?:\/\//i.test(url)) throw new Error('只接受 http(s) 网址')
    if (s.viewMode !== 'canvas') s.setViewMode('canvas')
    s.addWebNode(loc.frameId, url)
    return { opened: url, frameId: loc.frameId }
  }

  if (tool === 'canvas_open_html' || tool === 'canvas_open_file') {
    const p = String(args.path ?? '')
    if (!p) throw new Error('缺少 path')
    const abs = safePath(p, loc.projectPath, ctx.project)
    // 校验文件真实存在：否则会开出一个空白预览节点，AI 还以为成功了
    const probe = await window.api.fs.probePaths([abs], loc.projectPath || ctx.project || '/')
    if (!probe[0]) throw new Error(`文件不存在：${abs}`)
    if (probe[0].isDir) throw new Error(`这是目录不是文件：${abs}`)
    if (s.viewMode !== 'canvas') s.setViewMode('canvas')
    if (tool === 'canvas_open_html' || isWebFile(abs)) {
      s.addWebNode(loc.frameId, fileUrlOf(abs))
      return { opened: abs, as: 'browser', frameId: loc.frameId }
    }
    // 其它文件：按扩展名给出预览节点（图片/视频走 image，其余走 code）
    const ext = abs.split('.').pop()?.toLowerCase() ?? ''
    const media = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'mp4', 'm4v', 'webm', 'mov', 'mkv']
    const pane = media.includes(ext)
      ? ({ kind: 'image', filePath: abs } as const)
      : ({ kind: 'code', filePath: abs } as const)
    s.addFileNode(loc.frameId, pane, 0, 0)
    return { opened: abs, as: pane.kind, frameId: loc.frameId }
  }

  throw new Error(`未知工具：${tool}`)
}

// 指示灯上显示的一句话：优先展示这次动了什么（路径/网址/名字），不然只显示工具名
function detailOf(tool: string, args: Args): string {
  // 词典写入没有路径可显示，但它是「AI 往我硬盘里加东西」，指示灯上必须说清加了几个
  if (tool === 'dict_add') {
    const n = Array.isArray((args as { terms?: unknown[] }).terms)
      ? (args as { terms: unknown[] }).terms.length
      : 0
    return `${n} 个词条`
  }
  const a = args as { path?: string; url?: string; message?: string; text?: string; name?: string; node_id?: string }
  const v = a.path ?? a.url ?? a.message ?? a.text ?? a.name ?? a.node_id ?? ''
  const short = String(v).split('/').pop() ?? ''
  return short.length > 40 ? short.slice(0, 40) + '…' : short
}

export function registerMcpHandler(): void {
  window.api.mcp.onInvoke(({ id, tool, args, ctx }) => {
    void (async () => {
      const a = (args ?? {}) as Args
      try {
        if (!useStore.getState().mcpEnabled) {
          throw new Error('用户已在 Eas-Term 里关闭 MCP 接入')
        }
        const data = await runTool(tool, a, ctx ?? {})
        useStore.getState().logMcp({ tool, detail: detailOf(tool, a), ok: true })
        window.api.mcp.reply({ id, ok: true, data })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        useStore.getState().logMcp({ tool, detail: msg, ok: false })
        window.api.mcp.reply({ id, ok: false, error: msg })
      }
    })()
  })
}
