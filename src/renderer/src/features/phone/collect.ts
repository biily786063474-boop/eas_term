// 手机端要的三样东西，从画布状态里挑出来。**纯函数，不碰 store、不碰 IPC**
// —— 手机端这条链路上，「挑什么给它看」是唯一有业务判断的一环，
// 必须能单测；剩下的（HTTP、加密、隧道）都是搬运。
//
// 边界口径来自 docs/手机端-需求规格.html，三条最要紧的：
//  ① 「已打开的项目」= 画布上有顶层 Frame 的，不是 projects.json 里的全部
//  ② 文件只列 **Frame 里的**（freeNodes 一律排除，用户原话「仅显示已经放在 frame 中的」）
//  ③ **不返回绝对路径** —— 路径本身就是信息（暴露目录结构），手机端不需要它也能工作
import type { CanvasFrame, CanvasNode } from '../../store/canvas/types'
import type { Project } from '../../../../shared/types'

/** 一台会话在手机上的样子。ptyId 对终端是 pty 号，对 AI 对话是 sessionId —— 
 *  跟甘特图 GanttTask.ptyId 是同一个历史包袱，同样靠 kind 区分。 */
export interface PhoneSession {
  /** 手机端拿它回指某个会话；不是路径、不是 pid */
  id: string
  kind: 'terminal' | 'agent'
  title: string
  /** 在跑（spinner 转着） */
  running: boolean
  /** 等你处理（attention 标记） */
  waiting: boolean
}

export interface PhoneProject {
  id: string
  name: string
  running: number
  waiting: number
  /** 这个项目下有几个会话（含空闲的） */
  sessions: number
}

export interface PhoneFile {
  /** 画布节点 id。**动作 4 只接受它，不接受路径** */
  id: string
  name: string
  kind: 'doc' | 'image'
  /** 它在哪个 Frame 下（顶层 Frame 名 or 子 Frame 名），手机上分组用 */
  group: string
}

/** 顶层 Frame（项目 Frame）—— parentId 为空的那些 */
const isTop = (f: CanvasFrame): boolean => !f.parentId

/** 这个 Frame 及其全部子 Frame。子 Frame 是文件夹分组，文件要连它们一起收。 */
function withChildren(frames: CanvasFrame[], top: CanvasFrame): CanvasFrame[] {
  const out = [top]
  // 只下探一层就够 —— 现有实现里子 Frame 不再嵌套（folderPath 是扁平的文件夹）。
  // 真出现多层时这里会漏，但漏的表现是「少列几个文件」，不是越界读到不该读的，
  // 安全侧不依赖这个遍历的完整性（那由 fsGuard 兜）。
  for (const f of frames) if (f.parentId === top.id) out.push(f)
  return out
}

/** 节点上那个会话的 id：终端取 ptyId，AI 对话取 sessionId。取不到 = 还没起来 */
function sessionIdOf(n: CanvasNode): string | null {
  const p = n.pane
  if (!p) return null
  if (p.kind === 'terminal') return p.ptyId || null
  if (p.kind === 'agent') return p.sessionId || null
  return null
}

/** 会话在手机上叫什么。节点自定义名优先 —— 那是用户自己起的，比 tab 标题稳定。 */
function titleOf(n: CanvasNode, fallbackTitle: string | undefined, ordinal: number): string {
  const own = n.name?.trim()
  if (own) return own
  const t = fallbackTitle?.trim()
  if (t) return t
  return `${n.pane?.kind === 'agent' ? 'AI 对话' : '终端'} ${ordinal}`
}

/** 动作 1：画布上已打开的项目。**没在画布上摆出来的项目不出现**——跟你眼睛看到的一致。 */
export function collectProjects(
  frames: CanvasFrame[],
  projects: Project[],
  running: readonly string[],
  waiting: readonly string[]
): PhoneProject[] {
  const runSet = new Set(running)
  const waitSet = new Set(waiting)
  const out: PhoneProject[] = []
  for (const top of frames.filter(isTop)) {
    if (!top.projectId) continue // 不属于任何项目的 Frame 不进手机端
    const name = projects.find((p) => p.id === top.projectId)?.name ?? top.name
    let run = 0
    let wait = 0
    let n = 0
    for (const f of withChildren(frames, top)) {
      for (const node of f.nodes) {
        const id = sessionIdOf(node)
        if (!id) continue
        n++
        if (runSet.has(id)) run++
        if (waitSet.has(id)) wait++
      }
    }
    out.push({ id: top.projectId, name, running: run, waiting: wait, sessions: n })
  }
  return out
}

/** 动作 1 的下一层：某个项目里的会话。空闲的也列 —— 手机上它是灰的、点不进去，
 *  但「这个项目有 5 个会话，2 个在跑」这句话需要分母。 */
export function collectSessions(
  frames: CanvasFrame[],
  projectId: string,
  titleByLeaf: ReadonlyMap<string, string>,
  running: readonly string[],
  waiting: readonly string[]
): PhoneSession[] {
  const runSet = new Set(running)
  const waitSet = new Set(waiting)
  const top = frames.find((f) => isTop(f) && f.projectId === projectId)
  if (!top) return []
  const out: PhoneSession[] = []
  for (const f of withChildren(frames, top)) {
    for (const node of f.nodes) {
      const id = sessionIdOf(node)
      if (!id) continue
      const kind = node.pane?.kind === 'agent' ? 'agent' : 'terminal'
      out.push({
        id,
        kind,
        title: titleOf(node, node.leafId ? titleByLeaf.get(node.leafId) : undefined, out.length + 1),
        running: runSet.has(id),
        waiting: waitSet.has(id)
      })
    }
  }
  return out
}

/** 这个节点算不算「文档 / 图片」—— code 和 image 两种 pane，且真的挂着文件 */
function fileKindOf(n: CanvasNode): 'doc' | 'image' | null {
  const p = n.pane
  if (!p) return null
  if (p.kind === 'code' && p.filePath) return 'doc'
  if (p.kind === 'image' && p.filePath) return 'image'
  return null
}

/** 路径的最后一段当名字。跨平台都按 '/' 和 '\\' 切 —— 手机端可能在看一台 Windows 电脑。 */
function baseName(p: string): string {
  const parts = p.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** 动作 3：Frame 里的文档和图片，**只给名字**。
 *  freeNodes 不在参数里 —— 从签名上就杜绝「顺手把它也收进来」。 */
export function collectFiles(frames: CanvasFrame[], projectId: string): PhoneFile[] {
  const top = frames.find((f) => isTop(f) && f.projectId === projectId)
  if (!top) return []
  const out: PhoneFile[] = []
  for (const f of withChildren(frames, top)) {
    // 组名：顶层 Frame 用「主 Frame」这种泛称没有信息量，直接用它自己的名字；
    // 子 Frame 用文件夹名
    const group = f.name
    // 画布上从上到下、从左到右 —— 跟眼睛扫过去的顺序一致
    const nodes = [...f.nodes].sort((a, b) => a.y - b.y || a.x - b.x)
    for (const node of nodes) {
      const kind = fileKindOf(node)
      if (!kind) continue
      const path = node.pane?.kind === 'code' || node.pane?.kind === 'image' ? node.pane.filePath : null
      if (!path) continue
      out.push({ id: node.id, name: node.name?.trim() || baseName(path), kind, group })
    }
  }
  return out
}

/**
 * 动作 4 的**第一道**校验：这个节点 id 在不在该项目的 Frame 里，在的话它指哪个文件。
 *
 * **这不是安全边界，只是第一道。** 第二道是主进程的 fsGuard（项目根 + 知识库根）。
 * 两道都过才读 —— 这里防的是「id 是编的」，fsGuard 防的是「id 真但路径越界」
 * （比如有人把一个指向 ~/.ssh 的 code 节点拖进了 Frame）。
 * 少任何一道都不够：只有这道，构造一个合法 id 就能读任意路径；
 * 只有 fsGuard，项目根里的任何文件都能被列举出来。
 */
export function resolveFile(
  frames: CanvasFrame[],
  projectId: string,
  nodeId: string
): { path: string; kind: 'doc' | 'image' } | null {
  const top = frames.find((f) => isTop(f) && f.projectId === projectId)
  if (!top) return null
  for (const f of withChildren(frames, top)) {
    for (const node of f.nodes) {
      if (node.id !== nodeId) continue
      const kind = fileKindOf(node)
      if (!kind) return null
      const p = node.pane
      const path = p && (p.kind === 'code' || p.kind === 'image') ? p.filePath : null
      return path ? { path, kind } : null
    }
  }
  return null
}
