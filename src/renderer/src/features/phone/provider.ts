// 接主进程的问询，从 store 取数、交给 collect.ts 算，回给主进程。
//
// **这一层不做任何判断。** 挑什么给手机看全在 collect.ts（有 17 个单测），
// 谁能进来全在 main/phone/pairing.ts（有 18 个）。这里只是搬运 ——
// 有判断的地方必须能单测，这条是整个手机端功能的分层依据。
//
// **第 7 道锁「密钥永不出机器」在这里是结构性的**：本文件只调 collect 的三个
// 函数，它们的返回类型里没有任何密钥字段；secrets.json / keychain / MCP token
// 这条路上一次都不会被读到。不是「记得别传」，是根本没有能传的东西。
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { LeafInfo } from './collect'
import { collectFiles, collectProjects, collectSessions, collectStatus, resolveFile } from './collect'

/**
 * leafId → 那个 leaf 的种类 / 会话 id / 标题。
 *
 * **这张表是手机能不能看见桌面会话的关键。** 画布上正常开的终端和 AI 对话
 * 都只有 leafId、没有 pane（节点引用的是分屏那边的共享 leaf），
 * 所以种类和会话 id 只能从这里查 —— 本机实测 21 个这种节点对 3 个自带 pane 的。
 *
 * 标题跟甘特图用同一个信源（tab.title 是 shell OSC 写的，
 * agent 干活时会同步写入当前任务，比另起一套命名新鲜）。
 */
function leafMap(): Map<string, LeafInfo> {
  const m = new Map<string, LeafInfo>()
  for (const tab of useStore.getState().tabs) {
    for (const leaf of collectLeaves(tab.root)) {
      const p = leaf.pane
      if (p.kind === 'terminal') m.set(leaf.id, { kind: 'terminal', sessionId: p.ptyId || null, title: tab.title })
      else if (p.kind === 'agent') m.set(leaf.id, { kind: 'agent', sessionId: p.sessionId || null, title: tab.title })
    }
  }
  return m
}

async function answer(action: string, args: Record<string, unknown>): Promise<unknown> {
  const s = useStore.getState()
  const frames = s.canvas.frames
  const projectId = typeof args.projectId === 'string' ? args.projectId : ''

  switch (action) {
    case 'projects':
      return collectProjects(frames, s.projects, leafMap(), s.runningPtys, s.attentionPtys)
    case 'sessions':
      return collectSessions(frames, projectId, leafMap(), s.runningPtys, s.attentionPtys)
    case 'files':
      return collectFiles(frames, projectId)
    // 动态：跨项目的「现在怎么样了」。**「刚完成」直接读甘特图的记录** ——
    // 那份数据本来就在记「你发出去的话 → agent 干完」，不另造一套
    case 'status':
      return collectStatus(
        frames,
        s.projects,
        leafMap(),
        s.runningPtys,
        s.attentionPtys,
        await window.api.gantt.list().catch(() => []),
        Date.now()
      )
    // 'resolve' 和 'createSession' 都**不是手机能请求的动作**（白名单里没有它们）——
    // 它们是主进程内部问的一步。手机那边发的是 'file' / 'newSession'，
    // 而 newSession 还必须先过电脑上的人工确认才会走到这里。
    case 'resolve':
      return resolveFile(frames, projectId, typeof args.nodeId === 'string' ? args.nodeId : '')
    case 'createSession':
      return createSession(projectId)
    case 'startSession':
      return startSession(
        projectId,
        typeof args.nodeId === 'string' ? args.nodeId : '',
        typeof args.message === 'string' ? args.message : ''
      )
    default:
      return null
  }
}

/**
 * 在某个项目的 Frame 里新建一个 AI 对话节点。
 *
 * **只有走完「手机请求 → 电脑上点允许」才会调到这里**（见 main/phone/index.ts
 * 的 phone:allowRequest）。这个函数本身不做任何权限判断 —— 判断在那条链路上，
 * 重复判断只会让「到底谁说了算」变成两个答案。
 *
 * 三条边界：
 * · **只能建在已有的顶层 Frame 里** —— 不新建 Frame、不新建项目。
 *   手机能拉起的东西必须落在你已经摆出来的范围内。
 * · **cwd 用项目自己的路径**，不接受手机传路径（那等于让它选在哪跑）。
 * · 项目没有 Frame 就如实失败，不悄悄找个别的地方建。
 */
/**
 * 手机新建一个 AI 对话节点。
 *
 * ── 必须走 `addAgentNode`，不能用 `addFileNode` ────────────────────
 * 2026-08-30 用户实测撞到：手机建出来的节点在画布上是**一个空白的「预览」框**，
 * 点进去什么都没有。
 *
 * 原因是 `addFileNode` 建的是「自带 pane、没有 leafId」的形态，
 * 而那种形态走的是 `CanvasFileNode` 那条渲染路 —— **它只认 code/image/web**，
 * agent 落在那儿就是个空框。`materializeCanvas` 里其实早就写着这条
 *（"agent 落在那儿会渲染成一个空白框"），但它只在画布加载/切视图时跑，
 * **手机是运行时建的节点，没人给它补 leaf**。
 *
 * `addAgentNode` 是桌面那个「新建 AI 对话」按钮走的同一条路：建一个 agent leaf +
 * 一个引用它的画布节点，由 PaneLayer 渲染成真正的对话界面。
 *
 * **它仍然是惰性的**：`openAgentPane` 只建一个空闲的 pane（带「启动」按钮），
 * 不起任何进程 —— 手机新建不该在你电脑上拉起 agent，那条边界没变。
 */
async function createSession(projectId: string): Promise<{ ok: boolean; nodeId?: string; error?: string }> {
  const s = useStore.getState()
  const top = s.canvas.frames.find((f) => !f.parentId && f.projectId === projectId)
  if (!top) return { ok: false, error: '这个项目在画布上没有 Frame' }
  const proj = s.projects.find((p) => p.id === projectId)
  if (!proj?.path) return { ok: false, error: '这个项目没有目录' }
  const before = new Set(top.nodes.map((n) => n.id))
  await s.addAgentNode(top.id, { cwd: proj.path })
  const after = useStore.getState().canvas.frames.find((f) => f.id === top.id)
  const added = after?.nodes.find((n) => !before.has(n.id))
  if (!added) return { ok: false, error: '节点没建出来' }
  // **打上「手机碰过」的痕迹。** 不打的话它就是画布上悄悄多出来的一个框 ——
  // Frame 可能有一千多像素高，新节点落在中段，你根本不会注意到
  //（用户 2026-08-30 实测反馈：「并没在电脑端看到用户创建了会话」）
  useStore.getState().markPhoneNode(added.id, Date.now())
  return { ok: true, nodeId: added.id }
}

/**
 * 把一个还没启动的 AI 对话节点**真正跑起来**，并把第一条消息送进去。
 *
 * ── 这是手机第一次能在你电脑上拉起进程 ────────────────────────────
 * 之前 `createSession` 只往画布上加一个空节点，**不启动任何东西**
 *（那条注释还在上面）。用户 2026-08-30 明确要求「手机可以启动对话」——
 * 建出来一个聊不了的框确实没有意义。
 *
 * 但这一步的分量跟「加个节点」完全不同：**起来的是能读写你项目文件、
 * 能跑命令、能联网的 agent**。所以边界写死在这里，一条都不放开：
 *
 * · **只能启动画布上已经存在的节点** —— 不新建节点、不新建 Frame、不新建项目。
 *   手机能拉起的东西必须落在你已经摆出来的范围内。
 * · **cwd 用项目自己的路径**，不接受手机传路径（那等于让它选在哪跑）。
 * · **已经启动过的直接拒绝** —— 这条只负责「从无到有」，
 *   重复启动会把上一个会话变成没人管的孤儿。
 * · CLI **不由手机选**：用本机第一个可用的（和桌面空态同一条规则）。
 *   让手机指定 CLI 等于多一个它能影响的维度，收益却是零。
 *
 * 兜底仍在：设备得先配过对（那一步有人工确认）、每一次都留痕。
 */
async function startSession(
  projectId: string,
  nodeId: string,
  message: string
): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const s = useStore.getState()
  const top = s.canvas.frames.find((f) => !f.parentId && f.projectId === projectId)
  if (!top) return { ok: false, error: '这个项目在画布上没有 Frame' }
  const node = top.nodes.find((n) => n.id === nodeId)
  if (!node) return { ok: false, error: '这个节点已经不在画布上了' }
  const proj = s.projects.find((p) => p.id === projectId)
  if (!proj?.path) return { ok: false, error: '这个项目没有目录' }

  // **已经起来了就不许再起**：会话 id 可能挂在节点自己的 pane 上，
  // 也可能挂在它引用的 leaf 上（画布节点有这两种形态），两处都要看
  const leafSid = node.leafId
    ? (() => {
        for (const t of s.tabs) {
          const found = findLeaf(t.root, node.leafId as string)
          if (found?.pane.kind === 'agent') return found.pane.sessionId || null
        }
        return null
      })()
    : null
  // pane 是联合类型（terminal 没有 sessionId），先收窄再读
  const paneSid = node.pane && node.pane.kind === 'agent' ? node.pane.sessionId : undefined
  if (paneSid || leafSid) return { ok: false, error: '这个对话已经在跑了' }

  const clis = await window.api.agentChat.listClis()
  const usable = clis.find((c) => c.available && c.chatSupported)
  if (!usable) return { ok: false, error: '这台电脑上没有可用的 CLI' }

  const r = await window.api.agentChat.start({ cli: usable.id, cwd: proj.path, message })
  if (!r.ok) return { ok: false, error: r.error }

  // **把 sessionId 写回画布**，否则电脑上打开这个节点时接不回这个会话，
  // 手机下一次也认不出它已经起来了
  const st = useStore.getState()
  for (const t of st.tabs) {
    if (node.leafId && findLeaf(t.root, node.leafId)) {
      st.setAgentSessionId(t.id, node.leafId, r.sessionId)
      break
    }
  }
  // **自带 pane 形态的走另一条**（2026-08-30 补上）。
  //
  // 我原来在这儿写「实际影响很小，手机新建的是 leafId 形态」—— **那句是错的**，
  // 实测 `addFileNode` 建出来的节点带 `pane`、没有 `leafId`：
  // 也就是说**每一个手机新建的对话都落在这个洞里**，启动之后 sessionId 写不回，
  // 电脑上打开那个节点接不回这个会话。不是边角，是主路径。
  //
  // 补的是一个**只能写 sessionId 的窄动作**，不是通用的「改节点」——
  // 给手机一个能改画布任何东西的入口是另一个决定。
  if (!node.leafId) st.setNodeAgentSession(top.id, nodeId, r.sessionId)
  // 启动也算「手机碰过」——它比新建的分量更大（起来的是能跑命令的 agent）
  useStore.getState().markPhoneNode(nodeId, Date.now())
  return { ok: true, sessionId: r.sessionId }
}

/** 手机在某个已有会话上发了消息 → 找到挂着这段会话的节点，打上痕迹。
 *
 *  **这条不走 queryRenderer**：发消息是主进程直连 CLI 的（会话在 sessions 表里，
 *  跟界面开没开无关），所以主进程发一条事件过来，由这里把 sessionId 映回节点。
 *  映不到就静默忽略 —— 节点可能已经被关掉了，那不是错误。 */
export function notePhoneMessage(sessionId: string): void {
  const s = useStore.getState()
  for (const f of s.canvas.frames) {
    for (const n of f.nodes) {
      // 两种形态都要认：自带 pane 的（手机新建的就是这种），
      // 和引用分屏 leaf 的（桌面建的）
      if (n.pane?.kind === 'agent' && n.pane.sessionId === sessionId)
        return s.markPhoneNode(n.id, Date.now())
      if (n.leafId && findLeaf(s.tabs.find((t) => t.projectId === f.projectId)?.root, n.leafId)?.pane.sessionId === sessionId)
        return s.markPhoneNode(n.id, Date.now())
    }
  }
}

/** 在一棵分屏树里找某个 leaf。**递归而不是 collectLeaves** —— 这里只要一个，
 *  不值得为它把整棵树摊平 */
function findLeaf(node: unknown, leafId: string): { pane: { kind: string; sessionId?: string } } | null {
  const n = node as { type?: string; id?: string; pane?: { kind: string; sessionId?: string }; children?: unknown[] }
  if (!n) return null
  if (n.type === 'leaf') return n.id === leafId && n.pane ? { pane: n.pane } : null
  for (const c of n.children ?? []) {
    const f = findLeaf(c, leafId)
    if (f) return f
  }
  return null
}

let bound = false

/** 挂上监听。App 挂载时调一次；重复调用是空操作（HMR 下会重入）。 */
export function bindPhoneProvider(): void {
  if (bound) return
  bound = true
  // 手机在某段已有会话上发了消息 → 画布上把那个节点标出来
  window.api.phone.onTouched((sid) => notePhoneMessage(sid))
  window.api.phone.onQuery(({ id, action, args }) => {
    // **异步了**（status 要读甘特图），但仍然一定要 reply ——
    // 不 reply 主进程会一直等到超时，用户看到「电脑正忙」而真实原因埋在这里
    void answer(action, args ?? {})
      .catch((e) => {
        console.error('[phone] provider 出错', action, e)
        return null
      })
      .then((data) => window.api.phone.reply(id, data))
  })
}
