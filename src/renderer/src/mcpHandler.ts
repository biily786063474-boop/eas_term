// MCP 工具执行器（渲染层）：主进程把 AI 的调用转过来，这里落到 store action 再回结果。
//
// 上下文自动解析：调用方终端的 ptyId（PTY env 注入）→ 反查它挂在哪个 Frame / 哪个节点，
// 所以 AI 调 canvas_open_html 时不用指定 frame，产出直接开在「它自己所在的那个 Frame」里。
import { useStore } from './store'
import { collectLeaves } from './layout'
import { fileUrlOf, isWebFile } from './store/shared'

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

type Args = Record<string, unknown>

async function runTool(tool: string, args: Args, ctx: Ctx): Promise<unknown> {
  const s = useStore.getState()

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

export function registerMcpHandler(): void {
  window.api.mcp.onInvoke(({ id, tool, args, ctx }) => {
    void (async () => {
      try {
        const data = await runTool(tool, (args ?? {}) as Args, ctx ?? {})
        window.api.mcp.reply({ id, ok: true, data })
      } catch (e) {
        window.api.mcp.reply({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
  })
}
