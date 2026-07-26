// MCP 工具执行器（渲染层）：主进程把 AI 的调用转过来，这里落到 store action 再回结果。
//
// 上下文自动解析：调用方终端的 ptyId（PTY env 注入）→ 反查它挂在哪个 Frame / 哪个节点，
// 所以 AI 调 canvas_open_html 时不用指定 frame，产出直接开在「它自己所在的那个 Frame」里。
import { useStore } from './store'
import { collectLeaves } from './layout'
import { fileUrlOf, isWebFile } from './store/shared'
import type { CanvasFrame, CanvasNode } from './store/canvasSlice'
import type { PaneState } from './layout'

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
  const allows = [ctxProject, projectPath].filter(Boolean).map((x) => x!.replace(/\/$/, ''))
  const allow = allows.find((a) => norm === a || norm.startsWith(a + '/')) ?? ''
  if (!allow) {
    throw new Error(`路径越界，只允许项目目录内：${allows.join(' 或 ') || '(未知项目)'}`)
  }
  return norm
}

// nodeId 全局唯一（uid('cnode')），所以 AI 只用给 node_id，不必再指定 frame
function findNode(nodeId: string): { frame: CanvasFrame; node: CanvasNode } | null {
  for (const f of useStore.getState().canvas.frames) {
    const node = f.nodes.find((n) => n.id === nodeId)
    if (node) return { frame: f, node }
  }
  return null
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
      maximized: s.maximizedNode?.nodeId ?? null,
      currentFrameId: cur?.frameId ?? null,
      currentNodeId: cur?.nodeId ?? null,
      frames: s.canvas.frames.map((f) => ({
        id: f.id,
        name: f.name,
        isSub: !!f.parentId,
        collapsed: f.collapsed,
        project: s.projects.find((p) => p.id === f.projectId)?.path ?? null,
        nodes: f.nodes.map(describeNode)
      }))
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

    if (tool === 'canvas_focus_node') {
      s.focusCanvasNode(hit.frame.id, nodeId)
      return { focused: nodeId, frameId: hit.frame.id }
    }
    if (tool === 'canvas_maximize_node') {
      s.setMaximizedNode({ frameId: hit.frame.id, nodeId })
      return { maximized: nodeId }
    }
    if (tool === 'canvas_rename_node') {
      const name = String(args.name ?? '').trim()
      if (!name) throw new Error('缺少 name')
      s.renameNode(hit.frame.id, nodeId, name)
      return { renamed: nodeId, name }
    }
    // canvas_close_node：终端一律不给关。AI 判断不了里面有没有在跑的活，关错代价太大（用户已因误删终端吃过亏）
    if (hit.node.leafId) {
      const pane = paneOfLeaf(hit.node.leafId)
      if (!pane || pane.kind === 'terminal') {
        throw new Error('终端节点不允许由 AI 关闭，请让用户手动关')
      }
    }
    s.removeNode(hit.frame.id, nodeId)
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
