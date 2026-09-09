import { insertVoiceAtSelection } from '../voice/voiceTarget'
import { useMessageQueue } from './useMessageQueue'
import type { QueuedMessage } from './messageQueue'
import { ComposerInput, type ComposerInputElement } from './ComposerInput'
import { ReferenceHover } from './ReferencePreview'
import { ChatStatusIcon } from './ChatStatusIcon'
import { StartupSetupCard } from './StartupSetupCard'
import { SemanticIcon } from '../../ui/SemanticIcons'
import { StartupModelPicker } from './StartupModelPicker'
import { startupParams, type StartupChoice } from './startupParams'
import { StartupSandboxButton } from './StartupSandboxButton'
import { DEFAULT_STARTUP_SANDBOX, startupSandboxParams } from './startupSandbox'
// 通用 AI CLI 对话节点：空态起会话 + 对话态。
//
// 空态与对话态是**同一个组件的两个阶段**，不是两个组件——sessionId 一拿到就切阶段，
// 组件本身不重新挂载，事件订阅不会因为切阶段被打断（本文件正文见 task-3-brief.md）。
//
// 空态只做三件事：选 CLI（数据来自 Task 0 的 listClis，只有 detect() 探测到的才显示）、
// 输入首条消息、起会话。对话态渲染交给 Task 4 的 MessageList——事件从 start() 一返回
// 就被喂进归约器，这里只管把 view 状态传下去。
//
// **不允许按 CLI 名字分支**：CLI 选项、它的能力声明，全部来自 listClis() 原样透传的
// CliInfo，选项按钮只认 id/displayName，不认「是不是 claude」。
import { useEffect, useRef, useState, useMemo} from 'react'
import type {
  AgentApprovalHookStatus,
  AgentChatStartResult,
  ChatEvent,
  CliInfo
} from '../../../../shared/agentChat.ts'
import { createChatReducer, type ChatView, type Turn } from './reduce.ts'
import { mergeUserMessages, turnCursor, type SentMessage } from './userMessages.ts'
import { trimForSave, settleOnLoad, contextLostOf } from './history.ts'
import { startupPhaseOf } from './startupPhase.ts'
import { readLastCli, resolveConversationCli, writeLastCli } from './pickCli.ts'
import { usesApprovalHookFile } from './toolbarModel.ts'
import type { ApprovalDecision } from './ApprovalCard'
import { MessageList } from './MessageList'
import { ChatToolbar } from './ChatToolbar'
import { RolePicker } from './RolePicker'
import { CliBrandIcon } from '../../ui/CliBrandIcon'
import { SendIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, DictIcon } from '../../ui/Icons'
import { BranchBadge } from './BranchBadge'
import { CliSetupPanel } from './CliSetupPanel'
import { OmpSetupPanel } from './OmpSetupPanel'
import type { CliAuthState, HarnessId } from '../../../../shared/types'
import type { OmpStatus } from '../../../../shared/ompSetup'
import { CanvasContextMenu, type CanvasMenuItem } from '../../ui/CanvasContextMenu'
import { VoiceButton } from '../voice/VoiceButton'
import { useStore } from '../../store'
import { ComposerActions } from './ComposerActions'
import { useSlashPicker, SlashList } from './SlashPicker'
import { belongsToProject } from '../../../../shared/teamWorktree'
import { noteSubmitted, noteRunning, drainFollow, forgetPty } from '../gantt/collector'
import { collectLeaves } from '../../layout'
import './agentChat.css'
import { isSendKey, shouldPreventDefault, SEND_HINT } from './sendKey'
import { addChip, dropChip, expandChips, type DictChip } from './chips.ts'


// 会话刚起、任何事件都还没到达时 view 是 null（onEvent 至少要等第一个事件才会 setView）。
// 这段真空期用户已经能看到自己刚发的那条消息，不能因为 view 还是 null 就整屏空白——
// busy 给 true 是合理的默认值：start() 已经 resolve、进程正在跑，只是还没吐出第一个事件。
/** 「3 分钟前 / 2 小时前 / 8月19日」。孤儿记录列表用 —— 精确到秒没有意义，
 *  人要判断的是「这是不是我刚才那个」。 */
function fmtWhen(ts: number): string {
  const d = Math.max(0, Date.now() - ts)
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const dt = new Date(ts)
  return `${dt.getMonth() + 1}月${dt.getDate()}日`
}

const EMPTY_VIEW: ChatView = { model: null, quotas: [], turns: [], pending: null, notices: [], usage: null, costUsd: undefined, busy: true }

/** 预检的结果。**比 `CliAuthState` 宽一格，宽的只有 `cli` 这一个字段。**
 *
 *  `CliAuthState['cli']` 是 `'claude' | 'codex'` 的字面量联合 —— 那是 cliAuth 那面的
 *  **身份类型**（`STATUS_ARGS` / `LOGIN_ARGS` 都是以它为键的 Record），放宽它等于把
 *  `shared/types.ts` 和整个 `cliAuth/*` 一起拖下水，而那批文件承诺零改动。
 *  所以在**用的这一侧**放宽，源头一个字节不动。
 *
 *  下面 `installed` / `status` 两个字段的语义与 `CliAuthState` 逐字相同，
 *  尤其 **`status: null` 是「读不到」不是「没登录」** —— 闸门只在明确的
 *  `loggedIn === false` 上落下，读不到一律放行。 */
type AuthProbe = Omit<CliAuthState, 'cli'> & { cli?: string }

/** 问一次 omp 自己那条状态通道，归一成 `AuthProbe`。
 *
 *  **它不能走 `cliAuth.check`**：那套只认 claude / codex（见 preload 里 `api.omp`
 *  上方的注释），把 omp 送进去主进程直接抛。两条路各查各的，汇到同一个形状上，
 *  于是 `blockedByAuth`、`.ac-authgate`、`CliStateLabel` 这些下游一处都不用分叉。
 *
 *  `omp:status` 声明的返回是 `unknown`（preload 不想为它多引一个主进程类型），
 *  这里只挑用得上的两个字段落地，多的原样丢掉。 */
function probeOmp(): Promise<AuthProbe | null> {
  return window.api.omp.status().then((raw) => {
    // **判据是 `step`，不是某个「已登录」布尔。**
    // 原来读的是 `status.loggedIn`（`omp:status` 上曾有的一个字段）——
    // 2026-09-02 拆密钥柜时那个字段随手删了，而这里一声不吭地读到 undefined，
    // 于是闸门永远不出现、用户根本进不去设置面板。**类型断言把编译器也蒙了过去。**
    // 改成读 `step`：它是主进程算好的「还缺什么」，`ready` 才算配好。
    // **不再手写断言** —— preload 现在直接回真类型。
    // 断言正是这一类 bug 的温床：字段删了，`as` 照样让它编译通过，
    // 只在真机上表现为「闸门永远不出现」。
    if (!raw) return null
    const st = raw
    return {
      installed: !!st.installed,
      status: { loggedIn: st.step?.k === 'ready' }
    }
  })
}


export function AgentChatView({
  cwd,
  tabId,
  leafId
}: {
  cwd: string
  tabId: string
  leafId: string
}): JSX.Element {
  // 会话建立后把 sessionId 写回这个 leaf 的 PaneState——killPanePty（store/shared.ts）
  // 关闭节点时只认 store 里的这份，组件本地的 useState 它够不着（2026-08-15 审查
  // Important：不写回的话，关掉一个正在跑的 agent 节点不会停底层 CLI 进程，会话会在
  // 主进程那边无人看管地空转到 15 分钟空闲回收阈值，期间可能仍在花 token）。
  const setAgentSessionId = useStore((s) => s.setAgentSessionId)
  const setAgentResumeId = useStore((s) => s.setAgentResumeId)
  // 上次关掉这个节点时留下的 CLI 会话 id（随 canvas.json 落盘）。有它就说明这个节点
  // 之前聊过，起会话时带上 → 模型接得住上次的上下文。**从 store 现读**而不是存进
  /** 这个 leaf 在画布上对应的节点 id，**它才是跨重启稳定的那个**。
   *
   *  聊天记录原本按 leafId 存，而 `uid()` 是 `前缀-序号-随机`、persist 落盘时
   *  又 `delete copy.leafId` —— **leafId 每次重启都是新的**，于是重开软件后
   *  每个节点都读不到自己的历史（2026-08-20 实测：6 个恢复出来的 agent 节点
   *  一个都读不到，而磁盘上躺着 7 份记录）。agentHistory.ts 里那句
   *  「leafId 随 canvas.json 落盘、跨重启稳定」是错的。
   *
   *  画布节点 id（`cnode-…`）随 canvas.json 一起落盘，重启后原样回来，
   *  正是用户要的「一个模块和一个画布 ID 绑定，进去直接加载之前的对话」。
   *
   *  分屏模式下这个 leaf 可能没有画布节点 —— 那时退回 leafId：
   *  分屏布局本来就不跨重启保留，稳不稳定无所谓。 */
  const histKey = useStore((s) => {
    for (const f of s.canvas.frames) {
      const n = f.nodes.find((x) => x.leafId === leafId)
      // **chatId 优先**：点过「新对话」的节点挂着新的一段，没点过的就是节点自己
      if (n) return n.chatId ?? n.id
    }
    return leafId
  })

  /** 这个 leaf 对应的画布节点，拼成 `frameId|nodeId`。
   *  **返回字符串不返回对象** —— zustand 按 Object.is 比较，
   *  每次给个新对象就是每次都重渲染。 */
  const nodeRef = useStore((s) => {
    for (const f of s.canvas.frames) {
      const n = f.nodes.find((x) => x.leafId === leafId)
      if (n) return `${f.id}|${n.id}`
    }
    return ''
  })

  // 本地 state：它由 session.ready 事件写回 store，两处各存一份必然会不同步。
  const savedResumeId = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return undefined
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.resumeId : undefined
  })
  /** resumeId 的签发者。**归属从它推，不从 lastUsed 猜**（2026-09-04 事故的正解）。
   *  老数据没有 → 下面挑 CLI 的 effect 会查磁盘补上。 */
  const savedResumeCli = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return undefined
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.resumeCli : undefined
  })
  useEffect(() => {
    let alive = true
    void window.api.agentChat
      .loadHistory(histKey)
      .then((h) => {
        if (alive) setRestored({ turns: settleOnLoad(h.turns as Turn[]), resumeId: h.resumeId, resumeCli: h.resumeCli })
      })
      // 读不到就当没有历史。**不能让它挡住对话框起来** —— 这只是个锦上添花的功能
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // **依赖是 histKey 不是 leafId** —— 画布节点挂上/摘掉时 histKey 会变
    // （摘掉时退回 leafId），那时要按新的 key 重读一次
  }, [histKey])

  /** 这个节点是不是团队派生的。决定它进不进状态系统（灵动岛 / 铃铛 / 提示音）。 */
  const isTeamOwned = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return false
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' && leaf.pane.owner === 'team'
  })
  /** 派活时定下的角色名。跟 isTeamOwned 一起交给主进程存着 —— **不能只留在 pane 上**，
   *  节点关掉 pane 就没了，而进程还在跑，面板会认不出它是谁（见 SessionRecord.owner）。 */
  const teamRole = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return undefined
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.role : undefined
  })
  /** 派活塞进来的首条任务。**同样从 store 现读** —— 理由同 savedResumeId。 */
  const initialMessage = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return undefined
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.initialMessage : undefined
  })
  /** 首条消息预填（只进输入框，不发）。同样从 store 现读。 */
  const draft = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return undefined
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.draft : undefined
  })
  /** 这个节点指定了用哪个 CLI 吗（从「插件」选项卡开出来的会指定）。
   *  缺省 undefined = 沿用既有行为，自己挑第一个可用的。 */
  /** 这个面板选的角色。**订阅它**（不是读一次快照）—— 换角色要立刻反映到
   *  下一次 spawn，而换角色本身会重开会话，组件不重挂载。 */
  const roleId = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    const leaf = tab && collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.roleId : undefined
  })
  /** 这个面板的会话落在哪棵 worktree。**同样订阅** —— 第一次起会话时才建出来，
   *  建完工具栏的目录/徽标要立刻跟着变。
   *  （对象引用来自 pane，值不变时 setAgentWorktree 不造新对象，不会白重渲染。） */
  const worktree = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    const leaf = tab && collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.worktree : undefined
  })
  const roles = useStore((s) => s.roles)
  const setAgentRole = useStore((s) => s.setAgentRole)
  const setAgentWorktree = useStore((s) => s.setAgentWorktree)
  /** 真正起会话的目录：有 worktree 就是它，否则项目目录 */
  const effectiveCwd = worktree ? `${cwd}/${worktree.relPath}` : cwd
  const setAgentCli = useStore((s) => s.setAgentCli)
  const requestConfirm = useStore((s) => s.requestConfirm)
  /** 角色契约原文。**找不到那个 id 就当没角色** —— 用户可能把它删了，
   *  拿一个不存在的 id 去起会话不该硬失败。 */
  const role = roles.find((r) => r.id === roleId)
  const roleContract = role?.contract?.trim() || undefined
  /** 角色的能力意图。**和契约不同，它恢复会话时也要带** ——
   *  契约走系统提示（`--resume` 不重放），而能力边界是 CLI 层的强制规则。 */
  const roleBounds = role && (role.caps || role.raw) ? { caps: role.caps, raw: role.raw } : undefined

  const pinnedCli = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return undefined
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.cli : undefined
  })
  /** 这次会话要带的插件（一次只带一个）。透传给主进程决定工具面。 */
  const pluginId = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return undefined
    const leaf = collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.pluginId : undefined
  })
  const clearInitialMessage = useStore((s) => s.clearAgentInitialMessage)
  const clearAgentDraft = useStore((s) => s.clearAgentDraft)
  // null = 还没拉回来（探测中）；[] = 拉回来了但一个可用的都没有
  const [clis, setClis] = useState<CliInfo[] | null>(null)
  // 选中的整条 CliInfo（不只是 id）——capabilities 跟着一起存下来，供工具栏用（Task 6）
  const [selected, setSelected] = useState<CliInfo | null>(null)
  const [startupChoices, setStartupChoices] = useState<Record<string, StartupChoice>>({})
  const [sandboxChoice, setSandboxChoice] = useState<string>(DEFAULT_STARTUP_SANDBOX)
  const readOnlyRole = role?.caps?.write === false
  const sandboxParams = startupSandboxParams(selected?.id, sandboxChoice, readOnlyRole)


  // CLI 选择改成下拉（原来是一排芯片）。**三种状态仍然都列出来** —— 没装的、
  // 仅终端可用的都要能看见，那是用户第一次打开软件时唯一的「有哪些可选」的信息源。
  const [cliMenuAt, setCliMenuAt] = useState<{ x: number; y: number } | null>(null)
  const openCliMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setCliMenuAt({ x: r.left, y: r.bottom + 4 })
  }
  // Selection is the owner of every startup notice; never keep a second stale CLI note.
  const selectionEpoch = useRef(0)
  const selectedIdRef = useRef(selected?.id)
  selectedIdRef.current = selected?.id
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [refreshingClis, setRefreshingClis] = useState(false)
  const [authRevision, setAuthRevision] = useState(0)
  const pickCli = (c: CliInfo): void => {
    selectionEpoch.current++
    selectedIdRef.current = c.id
    setSelected(c)
    writeLastCli(c.id)
    setSetupFor(null)
    setAuth(null)
    setAuthChecking(false)
    setAuthRevision(v => v + 1)
    setStartError(null)
    setDiscoveryError(null)
    setRefreshingClis(false)
  }
  const installCli = (c: CliInfo): void => {
    setSetupFor({ cli: c, from: c.available ? 'login' : 'install' })
  }
  const refreshClis = async (cliId = selectedIdRef.current): Promise<void> => {
    const epoch = ++selectionEpoch.current
    setRefreshingClis(true)
    setDiscoveryError(null)
    try {
      const list = await window.api.agentChat.listClis()
      if (!aliveRef.current || epoch !== selectionEpoch.current) return
      setClis(list)
      const next = cliId ? list.find(c => c.id === cliId) : list.find(c => c.available && c.chatSupported) ?? list.find(c => c.chatSupported) ?? list[0]
      if (next) setSelected(next)
      else if (cliId) {
        setSelected(cur => cur ? { ...cur, available: false } : cur)
        setDiscoveryError('没有检测到当前 CLI，请检查安装后重试。')
      }
      setAuthRevision(v => v + 1)
    } catch {
      if (aliveRef.current && epoch === selectionEpoch.current)
        setDiscoveryError('检测未完成，请稍后重试。')
    } finally {
      if (aliveRef.current && epoch === selectionEpoch.current) setRefreshingClis(false)
    }
  }
  const completeSetup = (cliId: string): void => {
    if (selectedIdRef.current !== cliId) return
    setSetupFor(null)
    setAuth(null)
    void refreshClis(cliId)
  }
  const cliMenuItems: CanvasMenuItem[] = (clis ?? []).map((c) => ({
    label: c.displayName,
    leadingIcon: <CliBrandIcon cliId={c.id} bundled={c.bundled} />,
    hint: !c.available ? (c.bundled ? '运行文件缺失' : '未安装') : !c.chatSupported ? '仅终端' : c.id === selected?.id ? '当前' : undefined,
    onClick: () => pickCli(c)
  }))
  // **配好之后也要有路回设置面板。**
  //
  // 原来三个入口全是「出事了才出现」：空态闸门（没配好时）、工具栏那条
  // auth/setup notice（报错时）、以及安装流程。一旦配通，**入口全部消失** ——
  // 想换个服务商、或者不在会话里想换模型的起点，就无路可走了。
  // 2026-09-02 用户问：「配置好后想改模型的话，怎么通过 UI 去改？」
  // 真机数过：那时闸门 0 个、notice 0 个。
  //
  // 挂在换 CLI 那个菜单里 —— 用户本来就是从这儿挑 CLI 的，同一个地方一并解决。
  // **只对声明了 `provider-key` 的那支给**（omp）：claude / codex 走的是各自
  // CLI 的登录，没有「我们这边的设置」这回事。
  if (selected?.auth === 'provider-key' && selected.available && selected.chatSupported) {
    cliMenuItems.push({
      label: `设置 ${selected.displayName}…`,
      hint: '换服务商 / 换模型',
      onClick: () => setSetupFor({ cli: selected, from: 'login' })
    })
  }
  const [text, setText] = useState('')
  /** 空态输入框上挂的辞典提示词。对话态那份在 ChatToolbar 里，两边各管各的 —— 
   *  发出第一条之后这个框就没了，状态跟着它一起走正好 */
  const [chips, setChips] = useState<DictChip[]>([])
  /** 正文里**这一刻**引用到了哪些 chip。
   *  拿它区分正文引用和备选；没有正文引用时的兼容附带规则由 ComposerActions 提示。 */
  const refIds = useMemo(() => expandChips(text, chips, false).usedIds, [text, chips])

  // ── 点了 agent 给的某个选项 → **直接发出去** ────────────────────────────
  //
  // 用户 2026-09-02：「返回的选项卡无法点击、发送对应选项内容，需要打通这一层。」
  //
  // 原来是「填进输入框、等用户自己按发送」，理由是「识别是启发式的，
  // 不自动发 = 误点零代价」。**那个顾虑现在由识别本身兜住了**：
  // options.ts 的判据拿本机 748 条真实回复回归过，8 命中 / 0 误判，
  // 而且每一条都人工判过是真在问你选哪个（测试里逐条钉着）。
  //
  // **输入框里已经打的字不动。** 选项是独立的一句话，直接发它；
  // 用户正打到一半的内容留在原地，他自己决定要不要接着发 ——
  // 清掉它等于替他把话吃了。
  //
  // 发送口有两个，**不能在这里统一**：会话已经起来了要走
  // `handleFollowupSend`（它管乐观插入与失败回滚），还没起来要走 `handleSend`
  // （它负责起进程）。所以下面两处 MessageList 各接各的，这里不留中间层 ——
  // 中间层要么得用 ref 兜住闭包，要么就会在某一侧悄悄发错通道。
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // ── 分支徽标：这次会话到底跑在哪棵 worktree / 哪条分支 ──────────────
  //
  // 只在 `worktree` 存在时出现（角色声明了 isolation:'worktree'，且树已经建好）。
  // 徽标本身就是按钮，点开菜单做三件事：开个终端过去、起一个合并官把它合进主干、删掉这棵树。
  const openTerminal = useStore((s) => s.openTerminal)
  const [branchMenuAt, setBranchMenuAt] = useState<{ x: number; y: number } | null>(null)
  /** 协同板上有没有别的分支在改同一个文件。只影响徽标的底色和 tooltip 里那一句。 */
  const [branchOverlap, setBranchOverlap] = useState(false)
  const openBranchMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setBranchMenuAt({ x: r.left, y: r.bottom + 4 })
  }
  // 交集告警：打开菜单时刷一次板，读自己这条分支在不在 ⚠ 里。
  // **两处都要刷**——另一处挂在 turn.done 上（板每轮重算，徽标得跟着变），
  // 只留菜单那一处的话，不点开就永远看不到告警。
  useEffect(() => {
    if (!worktree || !branchMenuAt) return
    let live = true
    void window.api.board
      .read(cwd)
      .then((b) => {
        if (live) setBranchOverlap(b.overlaps.some((o) => o.branches.includes(worktree.branch)))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [branchMenuAt, worktree, cwd])
  /** 删掉这棵 worktree。**先确认 → 试删 → 只有「还有未提交的改动」才再确认一次带 force。**
   *
   *  ── 为什么第一次也要确认 ──
   *  没有未提交改动不等于「删了没事」：删完这个节点就回到主工作区，
   *  下面 done() 会把 resumeId 一起清掉，**这段对话接不回来了**。
   *  那是个不可撤销的后果，不该在点一下菜单之后静默发生。
   *
   *  ── 为什么成功时要清 resumeId ──
   *  handleSend 的首发守卫是 `role?.isolation === 'worktree' && !worktree && !savedResumeId`。
   *  只清 worktree 不清 resumeId 的话，守卫认为「这是在恢复一段旧会话」而不再建树，
   *  这个 pane 从此**静默地**跑在主工作区上，隔离白做。
   *  而且留着它也没有意义：Claude 的会话记录按 cwd 存，树都没了，那个 id 本来也续不上。
   *
   *  ── 为什么只有 `changed` 有值才引导 force ──
   *  `changed` 是主进程「因为还有 N 处未提交所以没删」的信号，只有这一种失败
   *  再删一次是有出路的。参数错、git 上着锁那类失败，把 force 摆出来只会让人
   *  以为那是条出路，点下去还是同样的错。 */
  const removeWorktree = (wt: { relPath: string; branch: string }): void => {
    // 失败一律说出来。**两次调用都要 .catch** —— IPC 本身 reject（主进程没起、
    // handler 抛了）走的不是 `{ ok: false }` 那条路，不接住就是一条 unhandled
    // rejection：菜单关掉、树还在、界面上什么都没发生。
    const fail = (msg: string): void =>
      requestConfirm({ message: `删不掉：${msg}`, confirmLabel: '知道了', onConfirm: () => {} })
    const oops = (e: unknown): void => fail(e instanceof Error ? e.message : String(e))
    const done = (): void => {
      setAgentWorktree(tabId, leafId, undefined)
      setAgentResumeId(tabId, leafId, '')
      // 树没了，「有别的分支在改同一个文件」这条告警也就无从谈起，
      // 不复位的话徽标消失前会闪一下黄色，下次建树还会带着上一棵的判断。
      setBranchOverlap(false)
    }
    const run = (force: boolean): Promise<{ ok: boolean; error?: string; changed?: number }> =>
      window.api.agentChat.worktreeRemove(cwd, wt.relPath, wt.branch, force)
    requestConfirm({
      message: '删掉这棵 worktree？分支保留；这个节点的对话会重新开始。',
      confirmLabel: '删除',
      onConfirm: () => {
        void run(false)
          .then((r) => {
            if (r.ok) return done()
            if (r.changed === undefined) return fail(r.error ?? '主进程没说原因。')
            // 有未提交改动 —— 主进程会把「还剩几处、去哪看」说清楚，
            // 那是 agent 这一趟的全部成果，不能默默抹掉
            //（teamWorktreeOps.ts 里那段注释记着当初 --force 抹掉成果的事故）。
            requestConfirm({
              message: `${r.error ?? ''}\n\n仍要删？未提交的改动会丢，分支保留；这个节点的对话会重新开始。`,
              confirmLabel: '删除',
              onConfirm: () => {
                void run(true)
                  .then((r2) => (r2.ok ? done() : fail(r2.error ?? '主进程没说原因。')))
                  .catch(oops)
              }
            })
          })
          .catch(oops)
      }
    })
  }
  const branchMenuItems: CanvasMenuItem[] = worktree
    ? [
        {
          label: '打开终端到这个 worktree',
          leadingIcon: <SemanticIcon kind="terminal" size={16} />,
          onClick: () => void openTerminal({ cwd: effectiveCwd })
        },
        {
          label: '合并到主干',
          leadingIcon: <SemanticIcon kind="merge" size={16} />,
          hint: '起一个合并官会话，首条消息已预填',
          // 在**同一个 Frame** 里起一个合并官节点，首条消息只预填不发 —— 合并是不可逆的，
          // 用户得看一眼分支名、按一下发送才算下令。CLI 沿用本节点的（合并官 kind:'auto'）。
          onClick: () => {
            const S = useStore.getState()
            const opts = {
              cli: selected?.id,
              roleId: 'merger',
              draft: `把 ${worktree.branch} 合进主干。先 merge_preflight，再 repo_impact，回归前后各一次。`
            }
            const frame = S.canvas.frames.find((f) => f.nodes.some((n) => n.leafId === leafId))
            // 分屏模式下这个 leaf 没有画布节点 —— 那就按普通 pane 开在同一项目里，
            // 别静默吞掉：用户点了菜单却什么都没发生，是最难查的那种。
            const p: Promise<unknown> = frame
              ? S.addAgentNode(frame.id, opts)
              : S.openAgentPane({ projectId: S.tabs.find((t) => t.id === tabId)?.projectId, ...opts })
            void p.catch((e: unknown) =>
              requestConfirm({
                message: `起不了合并官会话：${e instanceof Error ? e.message : String(e)}`,
                confirmLabel: '知道了',
                onConfirm: () => {}
              })
            )
          }
        },
        { sep: true, label: '', onClick: () => {} },
        {
          label: '删除 worktree',
          leadingIcon: <SemanticIcon kind="worktree" size={16} />,
          danger: true,
          // 会话跑着的时候删不得 —— 那棵树就是它此刻的 cwd。
          // 置 disabled 而不是藏起来：藏了用户会以为这个菜单本来就没这条。
          ...(sessionId ? { disabled: true, hint: '先结束会话' } : {}),
          onClick: () => removeWorktree(worktree)
        }
      ]
    : []

  // 这个 leaf 的 pane 上挂着的会话 id。**订阅它，不是读一次快照。**
  //
  // 下面那段「认领」逻辑原来是 `useStore.getState()` 读一次、依赖 `[selected, sessionId]`。
  // 那对「重启后恢复」是够的（挂载时 pane 上就有值），但对**别人在运行中把 sessionId
  // 写进来**是不够的 —— 2026-08-31 用户实测撞到：
  //
  //   ① 面板挂载，CLI 探测完 → 认领跑一次 → pane.sessionId 还是空 → return
  //   ② 手机启动了这个会话 → 把 sessionId 写进 pane
  //   ③ 组件因 store 变化重渲染，但 effect 依赖没变 → 认领不再跑
  //   ④ → 界面永远停在空态，而主进程手里连流式 delta 都齐全
  //
  // 订阅之后 ② 会让依赖变化，认领自然补上。
  const paneSessionId = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    const leaf = tab ? collectLeaves(tab.root).find((l) => l.id === leafId) : undefined
    return leaf?.pane.kind === 'agent' ? leaf.pane.sessionId : undefined
  })

  // ── 登录闸门 ──────────────────────────────────────────────────────
  //
  // **这是「一输入就自动关闭 CLI 进程」那条 bug 的正解。** 修复前，没登录的人
  // 打完字一发送，CLI 照常起得来（thread.started / turn.started 都发了），
  // 然后撞 401 反复重试、进程死掉，界面上只剩一句「CLI 进程退出（code 1）」。
  // 与其等它死了再解释，不如在发送之前就问一句。
  //
  // **为什么在渲染层查、而不是在主进程的 start 里查**：
  // `agentChat:start` 那个 handler 的同步性是承重的（见 preload/index.ts 里
  // 2026-08-17 评审那段：它在 return 之前就同步走完 deliverMessage → handleEvent
  // → wc.send，探针实测同步推的 30 条只到 1 条）。往那里加一个 await 会把整条
  // 事件时序改掉。所以查询放这儿，start 那侧一个字没动。
  //
  // **三态，不是两态**：登录了 / 没登录 / **读不到**。读不到时**不拦** ——
  // 那说明我们跟上游的输出格式脱节了，凭一次读不到就把人挡在门外，
  // 等于软件因为自己的解析问题拒绝工作。宁可放行、让 CLI 自己报错。
  const [auth, setAuth] = useState<AuthProbe | null>(null)
  const [authChecking, setAuthChecking] = useState(false)
  /** 正在给哪个 CLI 走「装 → 登录」这条链路。非空 = 设置面板挂着。
   *  from 决定从哪一步进：没装从安装进，装了没登录直接进登录。 */
  const [setupFor, setSetupFor] = useState<{ cli: CliInfo; from: 'install' | 'login' } | null>(null)
  /** 「关掉的对话」那段展开了没有。**默认收起** —— 见渲染处的注释。 */
  const [orphansOpen, setOrphansOpen] = useState(false)
  useEffect(() => {
    // 没选、没装、或者这个 CLI 不支持会话，都不用查 —— 那些有各自的提示路径
    setAuth(null)
    setAuthChecking(false)
    if (!selected || !selected.available || !selected.chatSupported) {
      setAuth(null)
      return
    }
    // 已经在跑的会话不查：它显然是能用的，查一次纯属白花几百毫秒
    if (sessionId && authRevision === 0) return
    let cancelled = false
    setAuthChecking(true)
    // **判据是能力位，而且必须写成排除式。**
    // 声明了 `provider-key` 的（omp —— 它压根没有「登录」这件事，只有「选服务商 + 填 key」）
    // 走自己那条状态通道，**其余一切原样走 `cliAuth.check`**。
    //
    // 反过来写成 `=== 'cli-login'` 会出事：`auth` 在 adapter 上是**后加的可选字段**，
    // Claude / Codex 一个都没声明它。今天 `buildCliList` 在合成 CliInfo 时补了默认值
    // 兜住这一层，但这条判据不该依赖那个默认值还在 —— 排除式写法在两种情况下都对，
    // 而 `=== 'cli-login'` 只要哪天默认值没补上就**恒假**，把两个旧 CLI 的登录预检
    // 整个跳过（spec 评审阶段实测过：闸门恒不落下、没登录的节点照发不误）。
    const probe: Promise<AuthProbe | null> =
      selected.auth === 'provider-key'
        ? probeOmp()
        : window.api.cliAuth.check(selected.id as 'claude' | 'codex')
    void probe
      .then((st) => {
        if (cancelled) return
        setAuth(st ? { ...st, cli: selected.id } : null)
        setAuthChecking(false)
      })
      .catch(() => {
        // 查询本身崩了也按「读不到」处理 —— 同样不拦
        if (cancelled) return
        setAuth(null)
        setAuthChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, sessionId, authRevision])

  /** **只有明确知道「没登录」时才拦。** 读不到（status 为 null）一律放行 */
  const blockedByAuth = !!auth && auth.cli === selected?.id && auth.installed && auth.status?.loggedIn === false
  const [view, setView] = useState<ChatView | null>(null)
  /** 上次退出时留在这个节点里的聊天记录。
   *
   *  **`resumeId` 让模型记得，这个让你看得见** —— 两者缺一不可：只有 resumeId 时，
   *  重启后界面是空的、一发消息模型却接着上次说，人会以为它在乱答。
   *  存取见 main/agentHistory.ts，裁剪与「卡在 running 的命令落到 failed」见 ./history.ts。 */
  const [restored, setRestored] = useState<{ turns: Turn[]; resumeId: string | null; resumeCli: string | null }>({
    turns: [],
    resumeId: null,
    resumeCli: null
  })
  // 用户自己发出去的消息——归约器从不产出它们（见文件头注释），渲染前要自己合并回去。
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])
  // 后续消息（send()）失败时的原因——展示交给 ChatToolbar，这里只持有（它拿着 sessionId）。
  const [sendError, setSendError] = useState<{ text: string; fatal: boolean } | null>(null)

  const reducerRef = useRef(createChatReducer())
  const unsubRef = useRef<(() => void) | null>(null)
  /** 空态那个输入框 —— 选完斜杠候选要把焦点还回去 */
  const emptyTaRef = useRef<ComposerInputElement>(null)
  // 防止「起会话」这次 await 还没回来、面板已经被切走/关掉——回来后不再 setState，
  // 也不再订阅一个已经没人看的会话（会话本身照样在主进程活着，不受这里影响）
  const aliveRef = useRef(true)

  // 面板卸载：解订阅，并把这个会话从全局状态信号里摘干净。
  // **不摘的话它会永远留在「正在跑」里** —— 运行监视上挂着一个再也不会更新的条目，
  // 侧栏项目点常亮，而对应的面板早就没了（同 store/shared.ts 里 killPanePty
  // 为终端做的事）。用 ref 读 sessionId：清理函数只在卸载时跑一次，闭包里的
  // state 会停在初值。
  const sessionIdRef = useRef<string | null>(null)
  sessionIdRef.current = sessionId
  useEffect(
    () => () => {
      aliveRef.current = false
      unsubRef.current?.()
      const sid = sessionIdRef.current
      if (sid) {
        const st = useStore.getState()
        st.setPtyRunning(sid, false)
        st.clearAttention(sid)
      }
    },
    []
  )

  // 聊天记录落盘。**真节流**：距上次落盘满 1 秒就立刻写，不满就补一个定时器。
  //
  // 以前这里写的是 `setTimeout(save, 1000)` + cleanup 里 clearTimeout —— 注释说「节流」，
  // 实现是**防抖**，而两者的差别恰好落在这个功能要防的那个场景上：
  //   · view 每个 token 变一次 → cleanup 每次都把上一个定时器取消掉
  //   · 于是只要 token 间隔小于 1 秒，那次写盘**永远排不到执行**
  //   · agent 连续输出 5 分钟 = 这 5 分钟一次都没落盘，中途崩了整轮全丢
  //   · 更确定的一条：**卸载时 cleanup 会取消还没到期的那次** ——
  //     用户在最后一段输出后 1 秒内关掉节点或切走视图，那段对话从没写进磁盘，
  //     而界面上明明显示过（.plans/silent-fail S-13）
  //
  // **依赖里放 view 而不是 displayView** —— 后者只在 sessionId 有值的分支里算得出来，
  // 而 hook 不能放在条件分支里。
  const lastSaveRef = useRef(0)
  /** 最新一份待落盘的数据。卸载时的兜底写用它 —— 那一刻 view 已经取不到了。 */
  const pendingSaveRef = useRef<Parameters<typeof window.api.agentChat.saveHistory> | null>(null)
  useEffect(() => {
    const turns = view?.turns
    if (!turns?.length) return
    // **存合并后的，不是归约器的原始输出。**
    //
    // 归约器从不产出 `role: 'user'`（CLI 不回显用户输入，见 mergeUserMessages
    // 上面那段），用户自己发的话只活在渲染层的 `sentMessages` 里、渲染时才合进去。
    // 原来这里存的是 `view.turns` —— 于是**磁盘上那份从来只有 AI 的话**：
    // 重开一个对话节点，你看不到自己问过什么，只剩它在自言自语。
    //
    // 2026-08-31 用户报「终端的吸顶效果不见了」时查出来的 —— 吸顶路标就挂在
    // user 轮次上（MessageList.tsx 的哨兵），没有 user 轮次自然没有路标。
    // 实测盘上最近三份历史：40/27/40 条，**角色分布全是 assistant**。
    // view 到这儿一定非空（上面 `if (!turns?.length) return` 挡过了），
    // 但类型上它仍是 ChatView | null —— 给个兜底而不是断言
    const merged = mergeUserMessages(view ?? EMPTY_VIEW, sentMessages).turns
    const args = [
      histKey,
      trimForSave([...restored.turns, ...merged]),
      savedResumeId || null,
      cwd,
      savedResumeCli || null
    ] as Parameters<typeof window.api.agentChat.saveHistory>
    pendingSaveRef.current = args
    const save = (): void => {
      lastSaveRef.current = Date.now()
      pendingSaveRef.current = null
      void window.api.agentChat.saveHistory(...args).catch((e) => {
        // 以前这里是 `.catch(() => undefined)`，写盘失败在渲染层完全无痕
        console.error('[agentChat] 聊天记录落盘失败', e)
      })
    }
    const since = Date.now() - lastSaveRef.current
    if (since >= 1000) {
      save()
      return
    }
    const t = window.setTimeout(save, 1000 - since)
    return () => window.clearTimeout(t)
    // sentMessages 进依赖：用户发一条之后要立刻反映到盘上那份，
    // 不然「发完就关掉节点」那条路又会丢掉最后一问
  }, [view, restored, histKey, savedResumeId, cwd, sentMessages])

  // 卸载兜底：把还没落盘的那一份写掉。
  // **必须单独一个 effect**（依赖 []）—— 挂在上面那个 effect 的 cleanup 里没用，
  // 它每次 view 变化都会跑一遍，分不清「又来了一个 token」和「组件真的没了」。
  useEffect(() => {
    return () => {
      const args = pendingSaveRef.current
      if (!args) return
      void window.api.agentChat.saveHistory(...args).catch((e) => {
        console.error('[agentChat] 卸载时补写聊天记录失败', e)
      })
    }
  }, [])

  // 空态：拉一次可用 CLI 列表——只渲染 detect() 探测通过的那些，没装的不出现，
  // 免得用户选了一个点了就报错的选项。
  useEffect(() => {
    let cancelled = false
    window.api.agentChat
      .listClis()
      .then((list) => {
        if (cancelled) return
        // **全部显示，不过滤。** 原来这里 filter 掉没装的，于是用户第一次打开软件
        // （一个 CLI 都没装）看到的是一句干巴巴的「没有探测到可用的 CLI」，
        // 连有哪些可选都不知道。现在没装的也列出来、标出来、点一下能装。
        setClis(list)
        // 活跃会话已有确定归属，发现 CLI 暂不可用也不能把身份/能力换成另一家。
        const activeCli = paneSessionId && list.find(c => c.id === pinnedCli)
        if (activeCli) { setSelected(cur => cur ?? activeCli); return }

        // 默认只选**现在就能用**的：装了 + 支持会话。没有就不预选，
        // 让用户自己点（点到没装的会给安装入口）
        const usable = list.filter((c) => c.available && c.chatSupported)
        // **pane 指定了就用它。** 插件属于哪个 CLI 是确定的（GitHub 是 Codex 的、
        // claude-mem 是 Claude 的），挑错家伙 = 那个插件的工具在会话里根本不存在。
        // 指定的那个没装 / 不支持会话时退回既有逻辑，不是硬失败——
        // 用户至少还能看到界面并自己换一个。
        // ── 已有对话：按 resumeId 的**签发者**定归属，不猜 ────────────────────
        // 2026-09-04 事故：一段 Claude 的对话重挂载时被 lastUsed（刚在别处用过的 omp）
        // 挑成 omp，Claude 的 id 递给 omp → "session not found" → 对话永久报废。
        // 老数据（2026-09-03 之前）只有 resumeId 没记签发者 → 查磁盘补上（三个 harness
        // 的会话都落在固定位置，按 id 找一下就知道是谁的）。
        void (async () => {
          let resumeCli = savedResumeCli
          if (savedResumeId && !resumeCli) {
            // **effectiveCwd 不是 cwd** —— Claude 的会话记录按 cwd 编码成目录名存
            // （`~/.claude/projects/<编码后的 cwd>/<id>.jsonl`，见 main/agentChat/resumeOwner.ts），
            // 而角色会话跑在 `.worktrees/<角色>-<id>/` 里。拿项目根去查，那段就在别的目录下，
            // 认不出来 = owner 为 null = 签发者补不上，resolveConversationCli 少一条依据，
            // 可能挑成别家 → dropResume，用户看到「这段对话的来源认不出来了」。
            const owner = await window.api.agentChat
              .resumeOwner(savedResumeId, effectiveCwd)
              .catch(() => null)
            if (cancelled) return
            if (owner) {
              resumeCli = owner
              setAgentResumeId(tabId, leafId, savedResumeId, owner) // 补签发者，下次不用再查
            }
          }
          const pick = resolveConversationCli(usable, {
            pinned: pinnedCli,
            resumeCli,
            hasResume: !!savedResumeId,
            lastUsed: readLastCli()
          })
          if (pick.dropResume && savedResumeId) {
            // 选出来的不是签发者：**id 不能跟过去**，递给一个认不得它的 harness 就是事故
            setAgentResumeId(tabId, leafId, '')
            // 这是**告知**不是崩溃：会话已经开成新的了，只是接不回上下文。
            // 按 2026-09-05 的规矩归为警告 —— 5s 没 hover 自动消失，也能手动关。
            setSendError({
              fatal: false,
              text: resumeCli
                ? `这段对话是 ${resumeCli} 开的，它现在不可用；已换成 ${pick.cli?.id ?? '别的'}，接不回之前的上下文。`
                : '这段对话的来源认不出来了（会话可能已被清理），已开成新的一段。'
            })
          }
          setSelected((cur) => cur ?? pick.cli ?? list.find(c => c.chatSupported) ?? list[0] ?? null)
        })()
      })
      .catch(() => {
        if (!cancelled) setClis([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 派活：pane 里带了首条任务就自动发出去。
  //
  // **等 selected 就绪才发** —— CLI 探测是异步的，早发一步 handleSend 会因为
  // 没有 selected 直接 return，那条任务就永远发不出去了（表现是「派了活但那个
  // agent 一直空着」，最难查的一种）。
  //
  // 用 ref 保证**只发一次**：清 store 是异步的，两次渲染之间它可能还没落地；
  // 而且首发失败（CLI 起不来）时也不该重试 —— 那会变成一个不断重开进程的循环。
  // 失败的结果照常显示在这个节点里，你看到了自己决定要不要重来。
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current || !initialMessage || !selected || sessionId || starting) return
    firedRef.current = true
    clearInitialMessage(tabId, leafId)
    setText(initialMessage) // 让它显示在输入框里，看得出这条是派给它的
    void handleSend(initialMessage)
    // handleSend 不进依赖：它每次渲染都是新函数，进依赖会变成死循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, selected, sessionId, starting, clearInitialMessage, tabId, leafId])

  // 预填：pane 里带了 draft 就摆进输入框，**不发送**（徽标菜单「合并到主干」）。
  // 不等 selected —— 它不起会话，没什么好等的；用 ref 保证只填一次，
  // 否则清 store 落地前的那次重渲染会把用户已经开始改的输入框覆盖回去。
  const draftFiredRef = useRef(false)
  useEffect(() => {
    if (draftFiredRef.current || !draft) return
    draftFiredRef.current = true
    setText(draft)
    clearAgentDraft(tabId, leafId)
  }, [draft, tabId, leafId, clearAgentDraft])

  /** override：派活时直接把任务传进来 —— 不走 state，因为同一帧里 setText 还没生效 */
  /** 把这个视图接到一个会话的事件流上。
   *
   *  **两条路共用**：自己 start 起来的（handleSend），和接管一个已经在跑的
   *  （团队面板点进来 —— 那个 agent 的画布节点可能早被关掉了，进程却还在跑）。
   *
   *  preload 从模块加载期就按 sessionId 缓冲事件，这里订阅时会先回放攒下的再转实时，
   *  所以接管一个跑到一半的会话不会只看到「从现在开始」的半截输出。 */
  const queuedEntriesRef = useRef(new Map<number, SentMessage>())
  const followupRef = useRef<(item: QueuedMessage) => Promise<boolean>>(async () => false)
  const messageQueue = useMessageQueue(sessionId, () => reducerRef.current.view().busy, item => followupRef.current(item))
  const messageQueueRef = useRef(messageQueue)
  messageQueueRef.current = messageQueue

  const attachTo = (sid: string): void => {
    unsubRef.current?.()
    unsubRef.current = window.api.agentChat.onEvent(sid, (e: ChatEvent) => {
      reducerRef.current.push(e)
      if (!aliveRef.current) return
      // session.ready 带的是 **CLI 自己的**会话 id（session.ts 拿它填 SessionRecord.resumeId）。
      // 写回 PaneState → 随 canvas.json 落盘 → 下次打开这个节点接得上上下文。
      // 每轮都会来一次，setAgentResumeId 里对相同值直接返回原对象，不会白白制造新状态。
      // 签发者 = 此刻跑着的这个 cli。**谁报回的 id 就记谁**，重挂载时不再猜归属。
      if (e.k === 'session.ready' && e.sessionId) setAgentResumeId(tabId, leafId, e.sessionId, selected?.id)
      const v = reducerRef.current.view()
      setView(v)
      const queue = messageQueueRef.current
      if (queue.sessionId === sid) {
        if (e.k === 'turn.start' || e.k === 'turn.done') queue.controller.event(e.k)
        else if (e.k === 'error' && e.fatal) queue.controller.event('fatal')
      }
      // ── 接进全局的通知系统 ──────────────────────────────────────
      // 运行监视 / 待处理列表 / 灵动岛 / 提示音 / 侧栏与抽屉的项目状态点，
      // 全都读 runningPtys + attentionPtys 这两份信号（machine.ts 的 statusOf）。
      // 终端那边由 TerminalView 按标题 spinner 的起落写入；AI 对话这边就是
      // turn.start / turn.done —— 语义完全对得上，不需要新造一套通知机制。
      //
      // **这两个 action 的参数名叫 ptyId 是历史包袱**，它们要的其实是「任务 id」；
      // 这里传会话 id，machine.locate 已经认得（见那边的说明）。
      const st = useStore.getState()
      // 协同板的交集告警：板在每轮结束后重算，徽标要跟着变。
      // **worktree 从 store 现读，不用闭包里那个**——这个回调在 attach 那一刻
      // 就定型了，而 worktree 是第一次发消息时才建出来的，闭包里那个值永远是
      // undefined，告警会静默地永不出现。
      // 不跟 isTeamOwned 走：团队派生的 agent 恰恰是最需要看交集的那批。
      if (e.k === 'turn.done') {
        const wtTab = st.tabs.find((t) => t.id === tabId)
        const wtLeaf = wtTab && collectLeaves(wtTab.root).find((l) => l.id === leafId)
        const wt = wtLeaf?.pane.kind === 'agent' ? wtLeaf.pane.worktree : undefined
        if (wt)
          void window.api.board
            .read(cwd)
            .then((b) => {
              if (aliveRef.current)
                setBranchOverlap(b.overlaps.some((o) => o.branches.includes(wt.branch)))
            })
            .catch(() => {})
      }
      // **团队派生的 agent 不进状态系统。**（用户 2026-08-19 拍板，真机截图确认）
      //
      // 上面那段说明对**用户自己开的**会话完全成立 —— 那是他在跟进的一件事，
      // 该进灵动岛、该在跑完时叫他一声。但团队里的 agent 不是：五个一起跑，
      // 灵动岛就变成「任务进行中 5」，全是他没在跟的东西；五个陆续跑完，
      // 他被叫五次。团队内部的进度只该在团队面板那一行上体现。
      //
      // 判据同 killPanePty / notify 那两处：pane.owner === 'team'，
      // 「谁开的」在整个应用里只有一个说法。
      if (!isTeamOwned) {
        st.setPtyRunning(sid, v.busy)
        // 甘特图采集。**挂在这里而不是另找信号** —— 上面那段说明已经论证过
        // 「turn.start / turn.done 就是 AI 对话版的 spinner 起落」，甘特图要的
        // 正是同一件事，没有理由再造一套判定。
        //
        // 跟着 isTeamOwned 一起排除团队派生的会话：那些不是用户自己在跟的事
        // （判据同上，用户 2026-08-19 拍板），画进图里只会让「我今天干了什么」
        // 变成一堆自己没参与的条。
        noteRunning(sid, v.busy, {
          projectId: st.tabs.find((t) => t.id === tabId)?.projectId ?? '',
          leafId,
          kind: 'agent'
        })
        // 一轮跑完就标记「有结果等你看」。**不判有没有聚焦**——跟终端那边一致
        //（TerminalView 在 spinner 落下时也是无条件 flagAttention），
        // 清除交给「用户真的去看了」那条路：点灵动岛/待处理列表会走 focusTerminal，
        // 直接点画布上的节点会走 CanvasStage 那个单选 effect。
        //
        // **但「它刚派完活」不算完成。** 主 agent 调完 team_spawn 那一轮就结束了，
        // 真正的活才刚开始跑 —— 这时候报「工作完成」、把灵动岛的进行中清掉，
        // 人会以为可以去看结果了（用户 2026-08-20 反馈）。
        // 判据问主进程的会话表，那是事实；查不到就按老路走，不因为一次 IPC 失败
        // 把「跑完了」这个提示整个吞掉。
        if (e.k === 'turn.done') {
          void window.api.agentChat
            .listSessions()
            .then((list) => {
              const teamAlive = list.some(
                (x) => x.owner === 'team' && x.alive && belongsToProject(x.cwd, cwd)
              )
              if (!aliveRef.current) return
              if (teamAlive) {
                // 派出去的还在跑：这个会话在等它们，灵动岛该继续显示「进行中」
                useStore.getState().setPtyRunning(sid, true)
                return
              }
              useStore.getState().flagAttention(sid)
            })
            .catch(() => {
              if (aliveRef.current) useStore.getState().flagAttention(sid)
            })
        }
      }
    })
  }

  /** 换一段新对话：结束当前会话，给节点写一个新 chatId，界面回到空态。
   *
   *  **旧那段不删** —— 它按旧 key 躺在磁盘上，之后还能从空态的
   *  「接上上次的对话」认回来。这里换的只是「这个窗口现在挂哪一段」。
   *
   *  为什么连会话一起停：用户要的是「重启一个任务」。留着旧进程的话，
   *  新对话的第一条消息会带着旧 resumeId 续上去，那就不是新的了。 */
  const handleNewChat = (discardQueue = false): void => {
    if (!nodeRef) return
    const queued = messageQueueRef.current.controller.snapshot().items
    if (queued.length && !discardQueue) {
      useStore.getState().requestConfirm({ message: '还有 ' + queued.length + ' 条消息未发送。放弃这些排队消息并新建对话？', confirmLabel: '放弃并新建', onConfirm: () => {
        handleNewChat(true)
      } })
      return
    }
    const [fid, nid] = nodeRef.split('|')
    if (!fid || !nid) return
    messageQueueRef.current.controller.dispose()
    queuedEntriesRef.current.clear()
    if (sessionId) window.api.agentChat.stop(sessionId)
    unsubRef.current?.()
    unsubRef.current = null
    setAgentSessionId(tabId, leafId, '')
    setAgentResumeId(tabId, leafId, '')
    // 交集告警跟着这一段对话一起清 —— 它是上一段跑出来的判断，
    // 留到新的一段上就是在拿旧事实染新徽标（下一轮 turn.done 才会重算）。
    setBranchOverlap(false)
    useStore.getState().startNewChat(fid, nid)
    // 本地状态全部回到「这个节点刚建出来」的样子。
    // **reducer 也要换新的** —— 不换的话上一段的轮次还留在里面，
    // 新会话第一个事件会接在旧对话后面。
    reducerRef.current = createChatReducer()
    adoptedRef.current = false
    setSessionId(null)
    setView(null)
    setRestored({ turns: [], resumeId: null, resumeCli: null })
    setSentMessages([])
    setSendError(null)
    setText('')
  }

  /** 换角色。**写码角色 + 已经有 resumeId + 还没有 worktree** 时先问一句。
   *
   *  handleSend 的首发守卫是 `role?.isolation === 'worktree' && !worktree && !savedResumeId`
   *  —— 带着旧 resumeId 换过去，守卫会认为「这是在恢复一段旧会话」而不建树，
   *  这个 pane 从此**静默地**跑在主工作区上，隔离白做。
   *  所以只有两条路：要么不换，要么把 resumeId 清掉当全新会话起（代价是接不回上下文）。
   *  取哪条由用户定，不替他选。和删 worktree 成功后 `done()` 里一并清 resumeId 是同一条处理。 */
  const handlePickRole = (next: string): void => {
    const nextRole = roles.find((r) => r.id === next)
    if (nextRole?.isolation !== 'worktree' || !savedResumeId || worktree) {
      setAgentRole(tabId, leafId, next)
      return
    }
    requestConfirm({
      message: `换成「${nextRole.name}」会在独立分支上重新开始这段对话（之前的上下文接不过去）。\n\n继续？`,
      confirmLabel: '继续',
      // 取消 = 角色不换。不清 resumeId、不动 pane，界面上那张卡回到原来那个角色。
      onConfirm: () => {
        setAgentResumeId(tabId, leafId, '')
        setAgentRole(tabId, leafId, next)
      }
    })
  }

  const handleSend = async (override?: string): Promise<void> => {
    if (override === undefined && emptySlash.consumeCommand()) return
    // override 是程序性发送（空态卡片上的「接上上次的对话」那种），不该带上 chip；
    // 用户自己按发送才展开挂着的提示词
    const expanded = override !== undefined ? null : expandChips(text, chips)
    const message = override !== undefined ? override.trim() : expanded!.text
    if (!message || !selected || !selected.available || !selected.chatSupported || starting || sessionId || refreshingClis || authChecking) return
    // **没登录就别起进程。** 起了也是撞 401 死掉，还白花一次冷启动，
    // 而用户看到的只会是「CLI 进程退出（code 1）」（2026-08-30 实测的原始症状）。
    // 打的字**留在输入框里** —— 登录完回来就能直接发，不用重打
    if (blockedByAuth) {
      setSetupFor({ cli: selected, from: 'login' })
      return
    }
    setStarting(true)
    setStartError(null)

    // Task 7 Step 1（Ruling 15）：第一次要在这个项目里装审批 hook 前，先问用户。
    // 判据是 CLI 自己声明的审批机制（usesApprovalHookFile ← CliInfo.approvalHook），
    // 跟主进程 restartAndDeliver 里 `adapter.approvalHook === 'claude-pretooluse'`
    // 是同一件事——2026-08-17 全分支最终评审 I3 之前这里用的是 capabilities.approval
    // 非空当替身，今天两个 adapter 恰好重合所以看不出来，但第三个 CLI 一接进来就分叉：
    // 那时 UI 会弹卡片问「要不要装审批钩子」→ 用户点「不装」→ 主进程那个分支对它
    // 从不进入 → 既不装、也不推 notice，用户以为自己拒绝了什么，实际什么都没发生。
    // （这不是按 CLI 名字分支：判的是机制声明，不是身份。）
    //
    // 用户选"不装"不再等于"不能用这个 CLI"（那是修复前的做法，跟内核 Ruling 14
    // "告知而非阻断"矛盾——那条裁定的原意就是"不装 hook 也能用，只是要让用户看见
    // 没保护"）。协调方补了 StartOpts.skipApprovalHook 这个开关（session.ts 的
    // restartAndDeliver 收到它就跳过装 hook，改发一条 notice），这里改成把用户的
    // 选择原样透传给 start()，会话照常起。
    // 审批保护现在是**设置里的一个开关，默认关**（2026-08-17）。
    // 原来这里会在首次发消息时弹一张卡片问「要不要装审批钩子」——那是每开一个新项目
    // 都要读一遍、按一次的打断，而绝大多数时候答案都是"不装"。
    //
    // 改成：默认不装，想要的人去右上角设置里开。对话框里不再出现任何相关 UI。
    // 内核那侧一个字没动 —— hook 的隔离标记、写前备份、一键卸载全都还在，
    // 只是入口从对话框搬进了设置面板（关掉开关会把已装的一并卸掉）。
    // 审批保护现在走**伪无头**那条路：不装 hook、不阻塞任何工具调用，
    // 而是把「先问再做」附进系统提示，让模型自己在动手前说明并等回复
    //（取舍见 shared/agentChat.ts 的 ASK_FIRST_PROMPT：软约定 vs 硬拦截）。
    // 所以 skipApprovalHook 恒为真 —— 那条 hook 路径整个不走了。
    const askFirst = useStore.getState().agentApprovalHook
    const skipApprovalHook = true

    let result: AgentChatStartResult
    try {
      // 写码角色第一次起会话前先把 worktree 建好，cwd 直接指过去 —— 模型没有「不开分支」的选项。
      // 只在**全新**会话且还没有 worktree 时建；恢复会话沿用 pane 上记的那棵。
      let startCwd = effectiveCwd
      if (role?.isolation === 'worktree' && !worktree && !savedResumeId) {
        const r = await window.api.roles.worktreeAdd(cwd, role.id)
        if (r.ok) {
          setAgentWorktree(tabId, leafId, { relPath: r.relPath, branch: r.branch })
          startCwd = r.absPath
        } else if (r.reason === 'not-git') {
          // 不静默降级：告诉用户会直接改主工作区，点「继续」才起
          const go = await new Promise<boolean>((resolve) =>
            requestConfirm({
              message: `这个目录不是 git 仓库，「${role.name}」会直接改主工作区。\n\n要继续吗？`,
              confirmLabel: '继续',
              onConfirm: () => resolve(true),
              onCancel: () => resolve(false)
            })
          )
          if (!go) {
            setStarting(false)
            return
          }
        } else {
          setStarting(false)
          setStartError(`建不了分支：${r.error}`)
          return
        }
      }
      // message 必填直接带上，不留到之后再 send()——Codex 的 exec 要靠它作为启动时的
      // 位置参数，没法「先开会话、再补第一条」；Claude 那边 start() 内部也已经把它
      // 当第一条写进 stdin 了，这里不需要（也不能）再调一次 send() 重复投递同一条消息。
      // resumeId：上次关掉这个节点时留下的 CLI 会话 id（随 canvas.json 落盘）。
      // 带上它，模型就接得住上次聊到哪；没有就是全新会话。
      // **失败要能退回全新会话** —— 见下面 catch 里那段：一个失效的 resumeId
      //（会话被 CLI 清理掉、换了机器…）不能让这个节点从此起不来。
      // 身份跟着会话走，不跟着节点走。两处 start 都要带 —— 漏掉哪条路径，
      // 走那条路起来的团队 agent 就成了面板认不出的匿名会话。
      const identity = isTeamOwned ? { owner: 'team' as const, role: teamRole } : {}
      // 角色的默认模型 / 档位按 harness 取；没填就交给 CLI 默认。会话起来后工具栏改的以那次为准。
      const roleModel = role?.model?.[selected.id as HarnessId]
      const roleEffort = role?.effort?.[selected.id as HarnessId]
      result = await window.api.agentChat.start({
        agentLeafId: leafId,
        cli: selected.id,
        // **不是 cwd 是 startCwd** —— 有 worktree 的会话必须起在那棵树里，
        // 否则它照样在改主工作区，隔离白做
        cwd: startCwd,
        message,
        skipApprovalHook,
        askFirst,
        // 角色契约。**两处 start 都要带** —— 漏掉哪条路径，
        // 走那条路开出来的会话就没有角色（同 identity 那条注释的理由）。
        ...(roleContract ? { roleContract } : {}),
        ...(roleBounds ? { roleBounds } : {}),
        ...startupParams(startupChoices[selected.id], roleModel, roleEffort),
        ...sandboxParams,
        // 角色 id 也要过去 —— 协同板按它查角色名，不带就是板上一行匿名分支
        ...(role?.id ? { roleId: role.id } : {}),
        ...identity,
        // 这次会话带哪个插件。**两处 start 都要带** —— 漏掉哪条路径，
        // 走那条路开出来的会话就没有插件的工具（同 identity 那条注释的理由）。
        ...(pluginId ? { pluginId } : {}),
        ...(savedResumeId ? { resumeId: savedResumeId } : {})
      })
      if (!result.ok && savedResumeId) {
        // 带着旧会话 id 起不来 → 多半是那个会话在 CLI 那边已经没了。
        // 清掉它重来一次，代价只是这次接不上上下文，总好过节点永久报废。
        setAgentResumeId(tabId, leafId, '')
        result = await window.api.agentChat.start({
        agentLeafId: leafId,
          cli: selected.id,
          // 重试路径同样走 startCwd（漏掉的话，一次重试就把会话搬回主工作区）
          cwd: startCwd,
          message,
          skipApprovalHook,
          askFirst,
          // 这条是「带着旧会话 id 起不来 → 清掉重来」的重试路径。
          // **角色同样要带** —— 漏掉的话，撞上一次重试就悄悄丢了角色，
          // 而用户什么都看不出来（界面上角色还显示着）。
          ...(roleContract ? { roleContract } : {}),
          ...(roleBounds ? { roleBounds } : {}),
          ...startupParams(startupChoices[selected.id], roleModel, roleEffort),
          ...sandboxParams,
          ...(role?.id ? { roleId: role.id } : {}),
          ...identity
        })
      }
    } catch (e) {
      if (aliveRef.current) {
        setStarting(false)
        setStartError(e instanceof Error ? e.message : String(e))
      }
      return
    }
    if (!result.ok) {
      if (aliveRef.current) {
        setStarting(false)
        setStartError(result.error)
      }
      return
    }
    // 会话已经真实建立（进程已经在跑，可能已经在花 token）。不管组件此刻是否还挂载，
    // 立刻把 sessionId 写回 store——这是 killPanePty 关闭节点时唯一找得到它的地方。
    // 必须放在 aliveRef 判断**之前**：如果等组件还活着才写，「start() 的 await 还没
    // 回来、面板就被切走/关掉」这种时序下 sessionId 会连本地变量都不落地，从诞生起
    // 就不可追踪，变成一个没人管的常驻会话（2026-08-15 审查 Important 点名的场景）。
    setAgentSessionId(tabId, leafId, result.sessionId)
    // **把这次真正用的 CLI 钉住**（用户 2026-09-03：「已经绑定的对话要用对应的
    // harness，不要随便切换 harness 底座」）。
    //
    // 和上面那句同处一个理由：放在 aliveRef 判断**之前**。这一刻会话已经真实存在，
    // 而它绑的是 `selected.id` 这个 harness —— 手里的 `resumeId` 也只有它认得。
    // 不钉的话，重挂载时 `pickDefaultCli` 会重挑，推测链里的 `readLastCli()`
    // 会随用户在别处切换 harness 而变，于是这段对话会悄悄换底座、且接不回上下文。
    setAgentCli(tabId, leafId, selected.id)
    // 首次为这个角色生成了项目章程（`docs/roles/<roleId>.md`，Task 3 的 `charterCreated`）：
    // 提示一句让用户去填边界段。两条 start 路径（首起 / 清掉失效 resumeId 重试）都汇到
    // 这里，所以只需写一处。走 store 而不是组件里的 hook 值：放在 aliveRef 判断之前，
    // 面板已被切走时也照样提示 —— 章程文件已经真实落盘了。
    // `requestConfirm` 是单槽，若此时已有确认框会覆盖 —— 已知留项，首次用角色那一刻
    // 不会同时弹别的。
    if (result.charterCreated)
      useStore.getState().requestConfirm({
        message: `第一次在这个项目用「${role?.name ?? '这个角色'}」，已生成一份它的项目章程：${result.charterCreated}。里面「可以改 / 不要碰」两段是空的，想给它划边界就填进去；这个文件以后不会被自动改。`,
        confirmLabel: '知道了',
        onConfirm: () => {}
      })
    // 面板已经被切走/关掉：不再订阅事件、不再 setState，但会话已经能从 store 里
    // 追踪到了，killPanePty 收得到——上面那句写回不受这里提前 return 的影响。
    if (!aliveRef.current) return
    // 尽快订阅，别拖到下一次交互。首事件不会丢，但**理由已经变了**（2026-08-17 最终
    // 评审 C1）：不再是"start() 一 resolve 就开始缓冲"——那条时序假设是错的，主进程在
    // handler 返回前就同步推完了首批事件。现在 preload 从模块加载期就挂着一个常驻监听器
    // 按 sessionId 缓冲，这里订阅时把攒下的先回放再转实时（见 preload/index.ts 的
    // AGENT_CHAT_EVENT_CHANNEL 一节）。
    const sid = result.sessionId
    attachTo(sid)
    // 甘特图：先挂上候选文本，等 turn.start 把它转成一条记录（见 collector.ts）。
    // **必须在 attachTo 之后** —— attachTo 会回放已缓冲的事件，turn.start 可能
    // 立刻就到；先订阅后挂候选的话，那一帧 pending 还是空的，首条就丢了。
    // 顺序反过来更安全：候选挂着但 turn.start 迟迟不来，最坏也只是这条不记，
    // 不会串到下一条上（同一个 sid 的候选被下一次 noteRunning 取走即清）。
    if (!isTeamOwned) noteSubmitted(sid, message)
    // beforeTurnCount 取 turnCursor——此刻订阅刚接上、一个事件都还没喂进去，必然是 0，
    // 但按公式算而不是硬编码 0：这条消息永远紧挨着插在它触发的第一个 assistant
    // 轮次之前，跟 mergeUserMessages 的合并逻辑对齐。
    setSentMessages((prev) => [
      ...prev,
      { text: message, beforeTurnCount: turnCursor(reducerRef.current.view()) }
    ])
    setSessionId(result.sessionId)
    setStarting(false)
    setText('')
    setChips([])
  }

  // **接管一个已经在跑的会话。**
  //
  // pane 上一挂载就带着 sessionId，只有一种来源：这个 leaf 是为了「去看一个
  // 已经存在的会话」而建的（团队面板点进来 —— 那些 agent 默认不挂画布节点，
  // 或者用户早就把节点关掉了，而进程还在跑）。这种情况下不该等用户发消息才连上，
  // 挂载即订阅。
  //
  // 顺带修好另一件事：自己起的会话在切视图 / 重新挂载后，本地 sessionId 是空的，
  // 而 pane 上那份还在 —— 以前那时界面是空白的，现在同样从这条路接回去。
  //
  // 这个 hook 待在上面那道「必须在条件 return 上游」的线**之内**（紧挨着它写），
  // 别把它挪到 `if (sessionId)` 之后 —— 那正是 React #300 的成因。
  const adoptedRef = useRef(false)
  useEffect(() => {
    // **必须等 selected 就绪**（跟上面 initialMessage 那个 effect 同一个理由）。
    // 聊天界面那段有一条不变量：「sessionId 有值 → selected 必然非空」，
    // 它原本靠「只有 handleSend 能设 sessionId，而 handleSend 顶上有 !selected 的门槛」
    // 成立。接管这条路绕开了 handleSend，抢在 CLI 探测完成前设 sessionId 的话，
    // ChatToolbar 那句 `selected!.capabilities` 当场读 null ——
    // 2026-08-20 真机验证抓到，整个界面被 ErrorBoundary 兜成错误页。
    if (adoptedRef.current || !selected || sessionId) return
    if (!paneSessionId) return
    adoptedRef.current = true
    setSessionId(paneSessionId)
    attachTo(paneSessionId)
    // 解绑不在这里做 —— 卸载时统一走上面那个 unsubRef 的清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sessionId, paneSessionId])

  // 空态输入框的斜杠候选。**跟对话态那个共用同一套**（SlashPicker.tsx），
  // 「哪些命令能用」只有一个说法。
  const emptySlash = useSlashPicker(
    text,
    setText,
    undefined,
    effectiveCwd,
    emptyTaRef,
    // 预加载的 chip 也进 `@` 候选，且排在文件前面
    chips,
    { cli: selected?.id, nativeSlash: selected?.capabilities.nativeSlash, boundPluginId: pluginId, model: !!selected?.available, effort: !!selected?.capabilities.effortLevels?.length, onAddChip: c => setChips(cur => addChip(cur, c)) }
  )

  // ⚠️ **下面这些 hook 必须待在所有条件 return 的上游。**
  //
  // 它们原本写在 `if (sessionId) { … return }` 之后 —— 于是空态跑 N 个 hook、
  // 聊天态只跑 N-2 个，而 React 靠调用顺序认 hook：数量一变就是
  // `Minified React error #300`（Should have a queue），整个界面被 ErrorBoundary 兜住变成
  // 「界面遇到了一个错误」。**触发点正是「发送第一条消息」** —— sessionId 从 null 变成有值
  // 的那一帧。2026-08-20 用户实拍到。
  //
  // 这个文件里已经有一处为同样的理由留的注释（存聊天记录那个 useEffect 说明为什么
  // 依赖里放 view 而不是 displayView），却还是在这儿犯了 —— 所以把警告写在这里，
  // 挨着最容易再犯的位置。
  /** 这个项目里「记录还在、但对应节点已经关掉了」的那些对话。
   *
   *  关节点不再删记录，于是它们成了孤儿 —— 新开的对话框是新 leafId，对不上。
   *  没有这个入口的话，留着跟删了没区别。 */
  const [orphans, setOrphans] = useState<
    { leafId: string; resumeId: string | null; savedAt: number; turns: number; preview: string }[]
  >([])
  useEffect(() => {
    // 只有自己是空的时候才需要这个入口；已经有内容就别拿别的对话去打扰
    if (sessionId || restored.turns.length > 0) return setOrphans([])
    let alive = true
    void window.api.agentChat
      .listHistory(cwd)
      .then((list) => {
        if (!alive) return
        // 「节点已经没了」现读一次布局算 —— 不订阅 tabs：这个判断只在打开空态那一刻
        // 需要，订阅了会让整个对话框跟着画布的任何变动重渲染
        const live = new Set(
          useStore
            .getState()
            .tabs.flatMap((t) => collectLeaves(t.root).map((l) => l.id))
        )
        setOrphans(list.filter((h) => !live.has(h.leafId)))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [cwd, sessionId, restored.turns.length])

  /** 把一份孤儿记录接管到当前这个节点：内容搬过来，resumeId 也接过来
   *  （模型那边才接得上），旧的那份再删掉，避免同一段对话留两份。
   *
   *  **顺序必须是先存后删。** 以前是读进内存 state 就立刻删磁盘上那份，而新的一份
   *  要等「有 view.turns」才写盘 —— 用户不发消息就永远没有 view。于是点了
   *  「接上上次」之后关掉节点 / 退出应用，那段对话既不在旧 leafId 文件里、
   *  也没进新 leafId，**不可恢复**（.plans/data-safety H1）。
   *  这条路径本来就是为「误关了要能捞回来」造的，结果它自己会把记录弄丢。 */
  const adoptOrphan = async (h: { leafId: string; resumeId: string | null }): Promise<void> => {
    const got = await window.api.agentChat.loadHistory(h.leafId).catch(() => null)
    if (!got) return
    const turns = settleOnLoad(got.turns as Turn[])
    setRestored({ turns, resumeId: got.resumeId, resumeCli: got.resumeCli })
    if (h.resumeId) setAgentResumeId(tabId, leafId, h.resumeId, got.resumeCli ?? undefined)
    setOrphans([])
    // 立刻把它写到新 leafId 名下 —— 不等 view，那要等用户发消息才有。
    const saved = await window.api.agentChat
      .saveHistory(histKey, trimForSave(turns), h.resumeId ?? got.resumeId ?? null, cwd, got.resumeCli)
      .catch(() => false)
    if (!saved) {
      // **存不成就不删。** 界面上内容已经接过来了，旧文件留着无非是多一份，
      // 而删掉是不可逆的。turns 为空时 save 也返回 false（那时本来也没什么可搬）。
      console.error('[agentChat] 接管的记录没能写到新节点名下，旧的那份保留不删')
      return
    }
    void window.api.agentChat.forgetHistory(h.leafId).catch(() => undefined)
  }

  // 对话态：MessageList 渲染真正的消息流（Task 4），审批卡片挂在里面（Task 5）。
  const handleFollowupSend = async (
    message: string,
    meta?: { text: string; images: { path: string; url: string }[] },
    queueId?: number
  ): Promise<boolean> => {
    const trimmed = message.trim()
    if (!trimmed || !sessionId) return false
    setSendError(null)
    // **turnCursor 不是 turns.length。** 后者到 MAX_LIVE_TURNS 就不再增长，
    // 于是第三问之后每条都记成同一个 60，减去 trimmedFromHead 后一起塌到 0
    // ——所有提问叠在开头，答案里一条吸顶路标都没有（turnCursor 注释里有实测）。
    const beforeTurnCount = turnCursor(reducerRef.current.view())
    // 乐观插入：先让这条消息出现在对话流里，界面才跟得上手速。但它是**乐观**的，
    // 失败时必须撤回——留着就是在骗人（那句话从来没有离开过这台机器）。
    // 按对象引用撤回，不按下标：撤回时数组里可能已经又多了别的消息。
    // 对话流里显示的是**你打的字 + 图本身**，不是拼给 CLI 的那串路径。
    // 没有 meta（别的调用方，比如 /compact）时退回原样显示整条。
    const entry: SentMessage = {
      text: meta ? meta.text : trimmed,
      images: meta?.images?.length ? meta.images : undefined,
      beforeTurnCount
    }
    const previous = queueId === undefined ? undefined : queuedEntriesRef.current.get(queueId)
    if (queueId !== undefined) queuedEntriesRef.current.set(queueId, entry)
    // Retrying the same queued request replaces its failed optimistic entry.
    setSentMessages((prev) => [...prev.filter(m => m !== previous), entry])
    const r = await window.api.agentChat
      .send(sessionId, trimmed)
      .catch((e): { ok: false; error: string } => ({
        // IPC 本身 reject（会话不存在之外的意外）以前是一条 unhandled rejection，
        // 界面上什么都不会发生、消息却已经显示在对话流里——跟 I4 是同一个失败面，
        // 顺手在这条路径上接住。
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      }))
    if (!aliveRef.current || messageQueueRef.current.sessionId !== sessionId) return r.ok
    if (r.ok) {
      // 甘特图。**只在真的送出去之后记** —— 失败那条已经从对话流里撤回了，
      // 记进图里等于留下一条从未发生过的任务。
      //
      // 记的是 entry.text（你打的字），不是 trimmed（拼了图片路径给 CLI 的那串）：
      // 图上要看的是"我当时问了什么"，不是那串本机路径。
      //
      // 两种情形分开：
      //   · 上一轮还在跑 → 这是补发，附到当前那条记录的 follow 上，不另开一根条
      //     （它没有自己的起止，硬拆只会让图上多出零长度的条——同 collector 的取舍）
      //   · 已经跑完了 → 挂成候选，等下一次 turn.start 转成新记录
      if (!isTeamOwned) {
        noteSubmitted(sessionId, entry.text)
        if (reducerRef.current.view().busy) drainFollow(sessionId)
      }
      return true
    }
    setSentMessages((prev) => prev.filter((m) => m !== entry))
    if (aliveRef.current) setSendError({ text: r.error, fatal: true })
    return false
  }
  followupRef.current = item => handleFollowupSend(item.text, item.meta, item.id)
  const enqueueFollowup = (text: string, meta?: QueuedMessage['meta'], mode: 'queue' | 'redirect' = 'queue') => messageQueue.controller.submit({ text, meta }, mode)

  if (sessionId) {
    // resolveApproval 需要 sessionId——ApprovalCard/MessageList 都不持有它（各自的
    // 声明式 props 只有 pending/onDecide、view/onApprovalDecide），IPC 调用统一收在
    // 这个组件里，跟 start()/onEvent 用同一个「谁持有 sessionId 谁管 IPC」的分工。
    const handleApprovalDecide = (approvalId: string, decision: ApprovalDecision): void => {
      void window.api.agentChat.resolveApproval(sessionId, approvalId, decision)
    }
    const live = mergeUserMessages(view ?? EMPTY_VIEW, sentMessages)
    // 历史接在这次会话的轮次**前面**。CLI 那边靠 resumeId 接上了上下文，但它不会
    // 重放旧消息，所以这次会话的 view 里只有新轮次 —— 不拼的话，界面上看起来像
    // 从头开始，而模型的回答却带着上文，非常割裂。
    const displayView =
      restored.turns.length > 0 ? { ...live, turns: [...restored.turns, ...live.turns] } : live
    // 后续消息：首条已经在 start() 里投递过了（见文件头 handleSend 的注释），这里走
    // send(sessionId, text)。beforeTurnCount 的算法跟首条消息完全一致——reducerRef 的
    // turns 只增不减，所以在这里现读它的长度、跟 mergeUserMessages 的插入位置对齐，
    // 不会因为这是「第 N 条」而需要不同的公式（上一轮审查点名过这条不变量，见任务交底）。
    // 返回「这条真的送出去了吗」——工具栏据此决定要不要把文字放回输入框（评审 I4）。

    return (
      <div className="agent-chat-view">
        <MessageList
          view={displayView}
          onApprovalDecide={handleApprovalDecide}
          leafId={leafId}
          // 会话在跑：走追问那条路（乐观插入 + 失败把字放回输入框）
          onPickOption={(t) => void enqueueFollowup(t)}
        />
        {/* selected 在这里必然非空：走到 sessionId 有值这一步，start() 必然已经过了
            handleSend 顶部 `!selected` 的门槛，且 selected 之后没有任何路径会被清空。 */}
        <ChatToolbar
          /* 会话**报过** capabilities 事件就用它覆盖静态清单。
             判据是「这条事件来过没有」（`view?.capabilities` 有没有值），不是 CLI 名字 ——
             不报的 CLI（Claude / Codex）走到 else，拿到的还是原来那份，行为一个字不变。
             对 omp 则是必需的：它的静态清单是空的（模型随服务商整份变，adapter 写不死），
             不覆盖的话工具栏里一个模型都选不了。 */
          caps={
            view?.capabilities ? { ...selected!.capabilities, ...view.capabilities } : selected!.capabilities
          }
          cli={selected!}
          approvalHook={selected!.approvalHook}
          view={displayView}
          cwd={cwd}
          onNewChat={() => handleNewChat()}
          sessionId={sessionId}
          onSend={enqueueFollowup}
          queue={messageQueue}
          onRemoveQueued={id => messageQueue.controller.remove(id)}
          onSteerQueued={id => messageQueue.controller.steer(id)}
          onRetryQueue={() => messageQueue.controller.retry()}
          onStop={() => { messageQueue.controller.pause(); window.api.agentChat.interrupt(sessionId) }}
          // 分支徽标（空态那份在下面的上下文条上，同一个组件）。
          // **会话跑着的时候正是最该看到分支的时候** —— 菜单里「删除 worktree」
          // 会因为 sessionId 有值而置灰，看和开终端不受影响。
          {...(worktree ? { worktree, effectiveCwd, branchOverlap, onOpenBranchMenu: openBranchMenu } : {})}
          // ── 角色入口**不在这里**（用户 2026-09-03）───────────────────────────
          // 角色契约走系统提示，`roleContract` 只在 `agentChat:start` 读一次 ——
          // **会话跑起来之后改它一点效果都没有**。摆在对话态工具栏上，
          // 等于给了一个改了也不生效的开关；原来只好用「确认 + 结束会话重开」
          // 兜着，那是在为一个放错位置的入口打补丁。
          // 现在它在**空态的上下文条**上，和「选哪个 CLI」并排 ——
          // 那两件事本来就是同一类：都是「这次对话开起来之前要定的」。
          onRefreshModels={() => void window.api.agentChat.refreshModels(sessionId)}
          onSetParams={(patch) => void window.api.agentChat.setParams(sessionId, patch)}
          sendError={sendError}
          onDismissSendError={() => setSendError(null)}
          onLogin={() => selected && setSetupFor({ cli: selected, from: 'login' })}
        />
        {/* 会话跑到一半掉线（token 过期）时的登录面板。
            **和空态那份是同一个组件**，摆在工具栏下面 —— 不用把人赶回空态，
            登完了直接接着聊。登录成功后 auth 也跟着更新，
            免得空态闸门那侧留着一份过期的判断。 */}
        {setupFor &&
          // **排除式分支**：只有明确声明 `provider-key` 的走 omp 那张面板，
          // 其余一切照旧。三处 `as 'claude'|'codex'` 断言留在 else 里 ——
          // 走到那儿的必然是 cliAuth 认识的那两个，断言仍然成立。
          (setupFor.cli.auth === 'provider-key' ? (
            <OmpSetupPanel
              key={setupFor.cli.id}
              cli={setupFor.cli}
              onCancel={() => setSetupFor(null)}
              onDone={() => completeSetup(setupFor.cli.id)}
            />
          ) : (
            <CliSetupPanel
              key={setupFor.cli.id}
              cliId={setupFor.cli.id as 'claude' | 'codex'}
              displayName={setupFor.cli.displayName}
              installCmd={setupFor.cli.installCmd}
              // `from: 'install'` 只会在用户**自己点了一个没装的 CLI** 时置起
              // （唯一置起点在上面那个 pickCliAndSetup）。那一下就是他的确认，
              // 所以不再停在「摆着命令等你点开始」那一屏。
              autoStart={setupFor.from === 'install'}
              from={setupFor.from}
              onCancel={() => setSetupFor(null)}
              onDone={() => completeSetup(setupFor.cli.id)}
            />
          ))}
        {/* 分支菜单。**两条 return 各渲染一次** —— 菜单本身走 portal 挂到 body，
            但 `branchMenuAt` 是同一份 state，哪条树在渲染就由哪条树摆出来。 */}
        {branchMenuAt && (
          <CanvasContextMenu
            x={branchMenuAt.x}
            y={branchMenuAt.y}
            items={branchMenuItems}
            onClose={() => setBranchMenuAt(null)}
          />
        )}
      </div>
    )
  }

  // 空态：居中 logo + 多行输入框 + CLI 选择器。
  // 「现在处于哪一步」收敛在 startupPhaseOf 里（纯函数、可测），不再靠四个散落的
  // 变量在 JSX 里现场拼判断——那样能拼出「又在起又已失败」这类不可能状态。
  // 这份历史是在哪个 CLI 会话下写的，跟当前 pane 上的对不对得上。
  // 对不上 = 模型接不回它，界面必须说明（理由见下面那段注释）。
  const contextLost = restored.turns.length > 0 && contextLostOf(restored.resumeId, savedResumeId)

  const phase = startupPhaseOf({ clis, selected, starting, startError })
  const startupActions = (
    <div className="ac-message-actions">
      <VoiceButton editorRef={emptyTaRef} ptyId={`agent-empty-${leafId}`} inline onText={(t) => { insertVoiceAtSelection(emptyTaRef.current, t, setText) }} />
      <button
        type="button"
        className="ac-input-send"
        aria-label="发送消息"
        data-tip={phase.k === 'starting' ? '正在启动会话…' : `发送（${SEND_HINT}）`}
        onClick={() => void handleSend()}
        disabled={(!text.trim() && !chips.length) || phase.k !== 'ready' || refreshingClis || authChecking || blockedByAuth}
      >
        {phase.k === 'starting' ? (
          <span className="ac-dot" aria-hidden="true" />
        ) : (
          <SendIcon size={18} />
        )}
      </button>
    </div>
  )

  return (
    <div className="agent-chat-view">
      <div className="ac-empty">
        {/* 有上次的聊天记录就直接摆出来，没有才显示 slogan。
            这一步是「看得见」那一半 —— 另一半（模型记得）靠 pane.resumeId，
            用户发出下一条消息时 start() 会带上它。 */}
        {restored.turns.length > 0 ? (
          <div className="ac-restored">
            <MessageList
              // 还没起会话：这一下**顺带把进程起起来**，选项就是第一句话
              onPickOption={(t) => void handleSend(t)}
              view={{ ...EMPTY_VIEW, turns: restored.turns, busy: false }}
              onApprovalDecide={() => undefined}
              leafId={leafId}
            />
            {/* **接不接得回上下文，必须说清楚。**
                记录绑在画布节点上，而模型的记忆绑在 CLI 的会话 id（resumeId）上 ——
                两者会分家：CLI 那边清理了旧会话、你换了个 CLI、或者上次 resume 失败被
                清掉过（见 handleSend 里那段 fallback）。
                那时界面上摆着满屏历史、模型却完全不记得，人看着历史会以为它记得 ——
                比空白更糟，空白至少是诚实的。 */}
            {contextLost ? (
              <div className="ac-restored-hint lost">
                以上是上次的记录，<b>模型接不回这段上下文了</b>
                （会话在 CLI 那边已失效，或者换过 CLI）。下一条消息是从头开始的。
              </div>
            ) : (
              <div className="ac-restored-hint">上次聊到这里 —— <b>点击发送继续对话</b></div>
            )}
          </div>
        ) : (
          <>
            {/* 空态这里原来是个 sparkle 图标。图标在这个位置只是"有个东西"，
                一句话能把这个软件是干什么的说清楚，还顺带告诉人下一步该做什么。 */}
            <div className="ac-slogan">伟大的产品始于一句“你好”</div>
          </>
        )}

        {/* 发送做成输入框右下角的图标，不再是底下那个独立的文字按钮：
            它就该长在输入框上，视线不用离开正在打字的地方。 */}
        {/* **有历史时用对话态的输入框尺寸。**
            两者的视觉（圆角/边/底）本来就是同一套，差的是**宽度与留白**：
            空态是 `min(720px)` 居中的高框 —— 那是「从零开始」该有的样子，
            大而居中，请你说第一句话。
            但有历史时上面已经摆着满屏对话了，再来一个居中大框，
            看着像是「另起一个新会话」而不是「接着上面聊」。
            用户 2026-09-02：「希望输入框保持和启动的时候样式一致。」 */}
        <div className={`ac-input-wrap${restored.turns.length > 0 ? ' resumed' : ''}`}>
          {emptySlash.open && <SlashList {...emptySlash} />}
          {chips.length > 0 && (
            <div className="ac-attach-row in-empty">
              {chips.map((c) => (
                <ReferenceHover key={c.id} reference={{id:c.id,kind:"dict",label:c.label,raw:"@"+c.label,payload:c.text,detail:"辞典提示词"}}><span
                  className={`ac-chip${refIds.includes(c.id) ? '' : ' idle'}`}
                  key={c.id}
                  data-kind="dict"
                >
                  <DictIcon size={11} />
                  <span className="ac-chip-label">{c.label}</span><span className="ac-chip-state">{refIds.includes(c.id) ? '本次引用' : '备选'}</span>
                  <button
                    type="button"
                    className="ac-chip-x"
                    aria-label={`不带「${c.label}」这条提示词`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setChips((cur) => dropChip(cur, c.id))
                    }}
                  >
                    <CloseIcon size={9} />
                  </button>
                </span></ReferenceHover>
              ))}
            </div>
          )}
          <ComposerInput
            {...emptySlash.inputProps}
          references={emptySlash.references}
            ref={emptyTaRef}
            className="ac-input"
            value={text}
            onChange={setText}
            // 聚焦时把「往这儿追加」登记到 store，名词词典点条目就插进这里而不是终端。
            // 在 onFocus 里注册而不是 mount 时：拿到的一定是当前这次渲染的 setText，
            // 也天然表达了「最后聚焦的是我」。
            onFocus={() => {
              emptySlash.syncSelection()
              const st = useStore.getState()
              st.setComposerAppend((t) =>
                setText((v) => (v && !/\s$/.test(v) ? v + ' ' : v) + t)
              )
              st.setComposerAddChip((c) => setChips((cur) => addChip(cur, c)))
            }}
            onKeyDown={(e) => {
              // 候选开着时先归它管 —— 上下键/Tab/Esc 在这一刻的意思跟平时不一样
              if (emptySlash.handleKey(e)) return
              // isComposing 只在**原生事件**上，React 的合成事件没有这个字段 ——
              // 取错了等于没做输入法保护（判据见 sendKey.ts）
              const k = { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
                isComposing: e.isComposing }
              if (!isSendKey(k)) return
              if (shouldPreventDefault(k)) e.preventDefault()
              void handleSend()
            }}
            placeholder={`跟 AI 说点什么…（${SEND_HINT}）`}
            rows={3}
            autoFocus
            disabled={phase.k === 'starting'}
          />
          <ComposerActions picker={emptySlash} text={text} chips={chips} />
          {/* 首轮参数与消息动作共用输入卡片，CLI 切换仍由 key 隔离目录请求。 */}
          {selected?.available && selected.chatSupported ? (
            <StartupModelPicker
              key={selected.id}
              cli={selected}
              choice={startupChoices[selected.id]}
              roleModel={role?.model?.[selected.id as HarnessId]}
              roleEffort={role?.effort?.[selected.id as HarnessId]}
              disabled={starting}
              actions={<>
                {selected.id === 'codex' && <StartupSandboxButton
                  value={sandboxParams.sandbox!} disabled={starting} readOnlyRole={readOnlyRole}
                  onChange={setSandboxChoice} />}
                {startupActions}
              </>}
              onChange={(choice) => setStartupChoices((current) => ({ ...current, [selected.id]: choice }))}
            />
          ) : (
            <div className="ac-input-bar"><span className="ac-model-unavailable">完成设置后选择模型</span>{startupActions}</div>
          )}

        </div>
        <div className="ac-ctxbar">
          {/* 显示的是**真正跑在哪** —— 有 worktree 时它是那棵树，不是项目根 */}
          <span className="ac-ctxbar-item" data-tip={effectiveCwd}>
            <SemanticIcon kind={worktree ? 'worktree' : 'folder'} size={16} />
            <span className="ac-ctxbar-name">
              {effectiveCwd.split('/').filter(Boolean).pop() ?? effectiveCwd}
            </span>
          </span>
          <button
            type="button"
            className="ac-ctxbar-item as-btn"
            onClick={(e) => openCliMenu(e)}
            disabled={phase.k === 'starting' || !clis?.length}
            data-tip="换一个 CLI"
          >
            <CliBrandIcon cliId={selected?.id} bundled={selected?.bundled} />
            <span className="ac-ctxbar-name">
              {selected?.displayName ?? (phase.k === 'detecting' ? '检测中…' : '选一个 CLI')}
            </span>
            <ChevronDownIcon size={10} />
          </button>
          {/* 角色。**和「选哪个 CLI」并排是有意的** —— 两者都是「这次对话
              开起来之前要定的」，而且都在 spawn 那一刻生效、之后改不了。
              默认没有角色（轮播第一张就是「无角色」）。 */}
          <RolePicker
            roleId={roleId}
            cli={selected?.id as HarnessId}
            onPick={handlePickRole}
          />
          {/* 分支徽标。对话态那份在 ChatToolbar 的控件行上，同一个组件。 */}
          {worktree && (
            <BranchBadge
              worktree={worktree}
              effectiveCwd={effectiveCwd}
              overlap={branchOverlap}
              onOpenMenu={openBranchMenu}
            />
          )}
          {!worktree && !savedResumeId && role?.isolation === 'worktree' && <span className="ac-ctxbar-item" data-tip="发送首条消息时创建独立工作区">
            <SemanticIcon kind="worktree" size={16} /><span className="ac-ctxbar-name">Worktree · 待创建</span>
          </span>}
        </div>
        {/* 这个项目里还留着、但节点已经关掉的对话。**不自动带进来** ——
            那是别的对话框的内容，替用户决定接上哪一段是越权；给入口、他自己挑。
            只列最近 3 条，再多就成了历史管理界面，不是这里该干的事。 */}
        {restored.turns.length === 0 && orphans.length > 0 && (
          <div className="ac-orphans">
            {/* **默认折叠**（用户 2026-09-03：「中间这个部分应该默认折叠，
                现在这种状态看起来太满了」）。
                空态第一屏该只有一句 slogan 和输入框 —— 三条历史摊开会把它填满，
                而那是「可能要接回去」的东西，不是「现在要做」的事。
                条数写在标题上：不展开也知道有没有、有几条。 */}
            <button
              type="button"
              className={`ac-orphans-t${orphansOpen ? ' on' : ''}`}
              onClick={() => setOrphansOpen((v) => !v)}
            >
              <ChevronRightIcon size={11} />
              这个项目里还有 {orphans.length} 段关掉的对话
            </button>
            {orphansOpen &&
              orphans.slice(0, 3).map((h) => (
              <button
                key={h.leafId}
                type="button"
                className="ac-orphan"
                onClick={() => void adoptOrphan(h)}
                title={h.preview}
              >
                <span className="ac-orphan-p">{h.preview || '（没有文字内容）'}</span>
                <span className="ac-orphan-m">
                  {h.turns} 轮 · {fmtWhen(h.savedAt)}
                </span>
              </button>
              ))}
          </div>
        )}
        {/* 有 resumeId = 这个节点之前聊过，上下文在 CLI 那边留着，发第一条就续上。
            不说的话用户会以为记录丢了。
            **但上面已经摆着历史时不要说这句** —— 它的原文是「上面的对话记录不保留」，
            那是聊天记录还不会落盘那会儿写的。现在记录会读回来显示在上面，
            这句就成了自相矛盾：中间写着「上次聊到这里 —— 发一条消息接着聊」，
            底下却说记录不保留（用户 2026-08-20 截图指出）。
            那种情况上面那条 ac-restored-hint 已经把事情说清楚了。 */}
        {savedResumeId && !restored.turns.length && (
          <div className="ac-resume-hint">接着上次的上下文继续（上面的对话记录不保留）</div>
        )}
        <StartupSetupCard
          cli={selected}
          detecting={phase.k === 'detecting' || refreshingClis || authChecking}
          blockedByAuth={blockedByAuth}
          error={discoveryError}
          alternatives={(clis ?? []).filter(c => c.available && c.chatSupported && c.id !== selected?.id)}
          onPick={pickCli}
          onSetup={() => selected && installCli(selected)}
          onRefresh={() => void refreshClis()}
        />
        {setupFor &&
          // 分支理由同对话态那处：**排除式**，只有 `provider-key` 走 omp，
          // 其余一切（含所有不声明这个字段的老 adapter）原样走 CliSetupPanel。
          (setupFor.cli.auth === 'provider-key' ? (
            <OmpSetupPanel
              key={setupFor.cli.id}
              cli={setupFor.cli}
              onCancel={() => setSetupFor(null)}
              onDone={() => completeSetup(setupFor.cli.id)}
            />
          ) : (
            <CliSetupPanel
              key={setupFor.cli.id}
              cliId={setupFor.cli.id as 'claude' | 'codex'}
              displayName={setupFor.cli.displayName}
              installCmd={setupFor.cli.installCmd}
              // `from: 'install'` 只会在用户**自己点了一个没装的 CLI** 时置起
              // （唯一置起点在上面那个 pickCliAndSetup）。那一下就是他的确认，
              // 所以不再停在「摆着命令等你点开始」那一屏。
              autoStart={setupFor.from === 'install'}
              from={setupFor.from}
              onCancel={() => setSetupFor(null)}
              onDone={() => completeSetup(setupFor.cli.id)}
            />
          ))}
        {cliMenuAt && (
          <CanvasContextMenu
            x={cliMenuAt.x}
            y={cliMenuAt.y}
            items={cliMenuItems}
            onClose={() => setCliMenuAt(null)}
          />
        )}
        {branchMenuAt && (
          <CanvasContextMenu
            x={branchMenuAt.x}
            y={branchMenuAt.y}
            items={branchMenuItems}
            onClose={() => setBranchMenuAt(null)}
          />
        )}
        {phase.k === 'failed' && <div className="ac-error" role="alert"><ChatStatusIcon fatal /><span>{phase.error}</span></div>}
      </div>
    </div>
  )
}
