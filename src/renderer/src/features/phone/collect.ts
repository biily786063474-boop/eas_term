// 手机端要的三样东西，从画布状态里挑出来。**纯函数，不碰 store、不碰 IPC**
// —— 手机端这条链路上，「挑什么给它看」是唯一有业务判断的一环，
// 必须能单测；剩下的（HTTP、加密、隧道）都是搬运。
//
// 边界口径来自 docs/手机端-需求规格.html，三条最要紧的：
//  ① 「已打开的项目」= 画布上有顶层 Frame 的，不是 projects.json 里的全部
//  ② 文件只列 **Frame 里的**（freeNodes 一律排除，用户原话「仅显示已经放在 frame 中的」）
//  ③ **不返回绝对路径** —— 路径本身就是信息（暴露目录结构），手机端不需要它也能工作
import type { CanvasFrame, CanvasNode } from '../../store/canvas/types'
import type { GanttTask, Project } from '../../../../shared/types'

/** 一台会话在手机上的样子。ptyId 对终端是 pty 号，对 AI 对话是 sessionId —— 
 *  跟甘特图 GanttTask.ptyId 是同一个历史包袱，同样靠 kind 区分。 */
export interface PhoneSession {
  /** 手机端拿它回指某个会话。
   *  **已启动的用会话 id，没启动的用画布节点 id** —— 后者是稳定的，
   *  而 sessionId 每次启动都变。 */
  id: string
  kind: 'terminal' | 'agent'
  title: string
  /** 已经起来了（有 pty / 有 session）。**false 不等于「不存在」** ——
   *  刚建出来还没聊过的 AI 对话就是这种：画布上看得见，进程还没起。 */
  started: boolean
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

/** 一个 leaf 的关键信息。**画布节点有两种形态**（见 CanvasNode 的注释）：
 *  · 自带 pane —— 画布独有的预览节点，以及手机端新建的那种
 *  · 只有 leafId —— **引用分屏那边的共享 leaf**，桌面上正常开的终端和 AI 对话
 *    全是这一种
 *  第二种的 kind / 会话 id / 标题都在 leaf 上，节点自己什么都没有。 */
export interface LeafInfo {
  kind: 'terminal' | 'agent'
  /** 已启动的会话 id（终端是 ptyId，AI 对话是 sessionId）；没启动是 null */
  sessionId: string | null
  title?: string
}

/**
 * 这个节点是不是一个「会话位」，以及它的会话 id。
 *
 * **必须同时认两种形态。** 原来这里只看 `n.pane`，于是手机上
 * **只能看见它自己新建的那几个** —— 桌面上正常开的终端和 AI 对话全走 leafId，
 * 一个都不出现。2026-08-29 用户报「电脑上新开的对话手机读不到」时查出来：
 * 本机画布上 21 个节点走 leafId（终端 6 + AI 对话 15），走 pane 的只有 3 个 agent。
 * 也就是说**日常在用的几乎全被漏掉了**。
 *
 * 我的单测全用 pane 造数据，所以一条都没抓到 —— 这条教训写在这里：
 * 造测试数据时如果只用其中一种形态，测的就只是那一种。
 */
function slotOf(n: CanvasNode, leaves: ReadonlyMap<string, LeafInfo>): LeafInfo | null {
  const p = n.pane
  if (p) {
    if (p.kind === 'terminal') return { kind: 'terminal', sessionId: p.ptyId || null }
    if (p.kind === 'agent') return { kind: 'agent', sessionId: p.sessionId || null }
    return null
  }
  return n.leafId ? (leaves.get(n.leafId) ?? null) : null
}

/** 会话在手机上叫什么。节点自定义名优先 —— 那是用户自己起的，比 tab 标题稳定。 */
function titleOf(n: CanvasNode, fallbackTitle: string | undefined, ordinal: number): string {
  const own = n.name?.trim()
  if (own) return own
  const t = fallbackTitle?.trim()
  if (t) return t
  return `会话 ${ordinal}`
}

/** 动作 1：画布上已打开的项目。**没在画布上摆出来的项目不出现**——跟你眼睛看到的一致。 */
export function collectProjects(
  frames: CanvasFrame[],
  projects: Project[],
  leaves: ReadonlyMap<string, LeafInfo>,
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
        const slot = slotOf(node, leaves)
        if (!slot) continue
        // **没启动的也算一个会话** —— 否则手机上刚新建的对话看不见，
        // 用户会以为没建成，然后再点一次
        n++
        const id = slot.sessionId
        if (!id) continue
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
  leaves: ReadonlyMap<string, LeafInfo>,
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
      const slot = slotOf(node, leaves)
      if (!slot) continue
      const sid = slot.sessionId
      out.push({
        // 没启动的用节点 id 回指 —— 它稳定，而 sessionId 每次启动都变
        id: sid ?? node.id,
        kind: slot.kind,
        title: titleOf(node, slot.title, out.length + 1),
        started: !!sid,
        running: !!sid && runSet.has(sid),
        waiting: !!sid && waitSet.has(sid)
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


// ── 动态：一屏回答「现在怎么样了」 ─────────────────────────────────
//
// 手机上最常问的一句话不是「有哪些项目」，是**「跑完了没」**。
// 所以这一屏跨项目汇总，而不是让人一个个项目点进去看。
//
// 三段的顺序是**按「要不要你现在动手」排的**，不是按时间：
//   等你处理 → 正在跑 → 刚完成
// 「等你」排最前是因为它是唯一会**卡住**的状态 —— agent 停在那儿等一句话，
// 你不给它就永远不动；而「在跑」和「完成」都不需要你做什么。

export interface PhoneLive {
  projectId: string
  projectName: string
  /** 会话 id（已启动）或节点 id */
  id: string
  kind: 'terminal' | 'agent'
  title: string
}

export interface PhoneFinished {
  projectName: string
  /** 当时问的那句话（截断） */
  prompt: string
  /** 什么时候完成的 */
  endAt: number
  /** 跑了多久 */
  durationMs: number
}

export interface PhoneStatusView {
  waiting: PhoneLive[]
  running: PhoneLive[]
  finished: PhoneFinished[]
}

/**
 * 跨项目的「现在怎么样了」。
 *
 * **「刚完成」的数据来自甘特图**（gantt.json 里每一轮都有 startAt/endAt）——
 * 不另造一套记录：那份数据本来就在记「你发出去的话 → agent 干完」，
 * 正是这一屏要的东西，而且它已经有 7 天保留期和落盘。
 */
export function collectStatus(
  frames: CanvasFrame[],
  projects: Project[],
  leaves: ReadonlyMap<string, LeafInfo>,
  running: readonly string[],
  waiting: readonly string[],
  tasks: readonly GanttTask[],
  now: number,
  finishedLimit = 12
): PhoneStatusView {
  const runSet = new Set(running)
  const waitSet = new Set(waiting)
  const nameOf = (pid: string | null): string =>
    (pid && projects.find((p) => p.id === pid)?.name) || '（未命名项目）'

  const live: { w: PhoneLive[]; r: PhoneLive[] } = { w: [], r: [] }
  for (const top of frames.filter(isTop)) {
    if (!top.projectId) continue
    const pname = nameOf(top.projectId)
    for (const f of withChildren(frames, top)) {
      for (const node of f.nodes) {
        const slot = slotOf(node, leaves)
        if (!slot?.sessionId) continue
        const item: PhoneLive = {
          projectId: top.projectId,
          projectName: pname,
          id: slot.sessionId,
          kind: slot.kind,
          title: titleOf(node, slot.title, 1)
        }
        // **等你** 优先于 **在跑**：一个会话可能两者都成立
        //（agent 跑完停下来等你，但 spinner 还没落），那时该按「等你」算
        if (waitSet.has(slot.sessionId)) live.w.push(item)
        else if (runSet.has(slot.sessionId)) live.r.push(item)
      }
    }
  }

  // 刚完成：按结束时间倒序。**只取已经结束的** —— 还在跑的那些在上面那段里
  const finished = tasks
    .filter((t) => typeof t.endAt === 'number' && !t.aborted)
    .sort((a, b) => (b.endAt ?? 0) - (a.endAt ?? 0))
    .slice(0, finishedLimit)
    .map((t) => ({
      projectName: nameOf(t.projectId),
      prompt: t.prompt.slice(0, 60),
      endAt: t.endAt as number,
      durationMs: Math.max(0, (t.endAt as number) - t.startAt)
    }))

  return { waiting: live.w, running: live.r, finished }
}
