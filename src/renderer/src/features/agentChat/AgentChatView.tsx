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
import { pickDefaultCli, readLastCli, writeLastCli } from './pickCli.ts'
import { usesApprovalHookFile } from './toolbarModel.ts'
import type { ApprovalDecision } from './ApprovalCard'
import { MessageList } from './MessageList'
import { ChatToolbar } from './ChatToolbar'
import { SendIcon, FolderIcon, SparkleIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, DictIcon } from '../../ui/Icons'
import { CliSetupPanel } from './CliSetupPanel'
import { OmpSetupPanel } from './OmpSetupPanel'
import type { CliAuthState } from '../../../../shared/types'
import type { OmpStatus } from '../../../../shared/ompSetup'
import { CanvasContextMenu, type CanvasMenuItem } from '../../ui/CanvasContextMenu'
import { VoiceButton } from '../voice/VoiceButton'
import { useStore } from '../../store'
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
  useEffect(() => {
    let alive = true
    void window.api.agentChat
      .loadHistory(histKey)
      .then((h) => {
        if (alive) setRestored({ turns: settleOnLoad(h.turns as Turn[]), resumeId: h.resumeId })
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
  /** 这个节点指定了用哪个 CLI 吗（从「插件」选项卡开出来的会指定）。
   *  缺省 undefined = 沿用既有行为，自己挑第一个可用的。 */
  /** 这个面板选的角色。**订阅它**（不是读一次快照）—— 换角色要立刻反映到
   *  下一次 spawn，而换角色本身会重开会话，组件不重挂载。 */
  const roleId = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    const leaf = tab && collectLeaves(tab.root).find((l) => l.id === leafId)
    return leaf?.pane.kind === 'agent' ? leaf.pane.roleId : undefined
  })
  const roles = useStore((s) => s.roles)
  const setAgentRole = useStore((s) => s.setAgentRole)
  const setAgentCli = useStore((s) => s.setAgentCli)
  const requestConfirm = useStore((s) => s.requestConfirm)
  /** 角色契约原文。**找不到那个 id 就当没角色** —— 用户可能把它删了，
   *  拿一个不存在的 id 去起会话不该硬失败。 */
  const role = roles.find((r) => r.id === roleId)
  const roleContract = role?.contract?.trim() || undefined
  /** 角色的工具边界。**和契约不同，它恢复会话时也要带** ——
   *  契约走系统提示（`--resume` 不重放），而工具边界是 CLI 层的强制规则，
   *  每次启动都要重新生效，不带等于恢复会话时把护栏卸了。 */
  const roleTools = role?.tools

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
  // null = 还没拉回来（探测中）；[] = 拉回来了但一个可用的都没有
  const [clis, setClis] = useState<CliInfo[] | null>(null)
  /** 点了一个不能直接用的 CLI（没装 / 仅终端）时，下面显示的说明 */
  const [cliNote, setCliNote] = useState<CliInfo | null>(null)

  /** 点未安装的 CLI → 弹确认框问装不装，点了「安装」就**开个终端把它跑起来**。
   *
   *  和原来的区别只在「谁按回车」：以前填进终端等用户自己敲，现在弹窗里点过就替他敲。
   *  **弹窗里必须原样列出要执行的命令** —— 用户得看得见自己在同意什么。
   *
   *  为什么仍然送进终端、而不是后台静默执行（agentInstall.ts 开头那三条，
   *  后两条和「是否静默」无关，所以保留）：
   *    · 装完还要 `claude login` 用自己的账号，那步永远绕不过去，藏后台没有意义
   *    · 公司网络 / 代理 / 权限失败时，报错摆在终端里用户能自己查，
   *      比一句「安装失败」有用得多
   *  第一条（静默装全局 CLI 是恶意软件行为特征）在这里不成立：这是用户在界面上
   *  主动点确认触发的，不是 agent 背着他装。 */
  //
  // **2026-08-30 改：不再弹确认框把命令甩进终端**（用户要求「AI 对话模式下的安装
  // 行为也不要去显示终端，要用安装进度条」）。改成就地打开 CliSetupPanel：
  // 先摆出命令原文让他看清 → 进度条 → 装完自动接上登录，全程不离开这个面板。
  // 上面那三条理由里只有第三条还成立（失败要能看到报错），CliSetupPanel 把它接住了：
  // 失败时展开输出尾部，并保留「把命令填进终端，我自己来」这条退路。
  //
  // **这是第三个会置 setupFor 的入口**（另两个是空态闸门与工具栏那条 notice）。
  // 它不用自己判断「该开哪张面板」—— 分支放在**渲染那一侧**（按 setupFor.cli.auth），
  // 三个入口于是自动都覆盖到了。判断写在这里的话，每加一个入口就要记得再判一次。
  const installCli = (c: CliInfo): void => {
    setCliNote(null)
    setSetupFor({ cli: c, from: c.available ? 'login' : 'install' })
  }
  // 选中的整条 CliInfo（不只是 id）——capabilities 跟着一起存下来，供工具栏用（Task 6）
  const [selected, setSelected] = useState<CliInfo | null>(null)


  // CLI 选择改成下拉（原来是一排芯片）。**三种状态仍然都列出来** —— 没装的、
  // 仅终端可用的都要能看见，那是用户第一次打开软件时唯一的「有哪些可选」的信息源。
  const [cliMenuAt, setCliMenuAt] = useState<{ x: number; y: number } | null>(null)
  const openCliMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setCliMenuAt({ x: r.left, y: r.bottom + 4 })
  }
  const cliMenuItems: CanvasMenuItem[] = (clis ?? []).map((c) => {
    const usable = c.available && c.chatSupported
    const tag = !c.available ? '未安装' : !c.chatSupported ? '仅终端' : null
    return {
      label: c.displayName,
      hint: tag ?? (c.id === selected?.id ? '当前' : undefined),
      // 不用 disabled：点不动的话就没法给出安装入口了（同芯片那版的理由）
      // 未安装且有安装命令的**直接弹确认框**，不再先给一张提示卡让用户再点一次；
      // 没有安装命令的（要去官网装）仍然给提示卡说明。
      onClick: () =>
        usable
          ? // **记下他的选择。** 下次新建会话就默认这个 ——
            // 用户 2026-09-02：「我上次用了 cc 下次新建还是 cc。」
            // 只在**手动切换**这一处记，不在自动挑选那处记：否则第一次的推测
            // 会被写成「他的选择」，从此再也回不到推测逻辑上去。
            (writeLastCli(c.id), setSelected(c))
          : !c.available && c.installCmd
            ? installCli(c)
            : setCliNote(c)
    }
  })
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
   *  拿它把 chip 行分成两种样子 —— 不显形的话，「预加载了但没 @、所以不会发」
   *  这件事用户完全看不出来。 */
  const refIds = useMemo(() => expandChips(text, chips).usedIds, [text, chips])

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
    if (!selected || !selected.available || !selected.chatSupported) {
      setAuth(null)
      return
    }
    // 已经在跑的会话不查：它显然是能用的，查一次纯属白花几百毫秒
    if (sessionId) return
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
        setAuth(st)
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
  }, [selected, sessionId])

  /** **只有明确知道「没登录」时才拦。** 读不到（status 为 null）一律放行 */
  const blockedByAuth = !!auth && auth.installed && auth.status?.loggedIn === false
  const [view, setView] = useState<ChatView | null>(null)
  /** 上次退出时留在这个节点里的聊天记录。
   *
   *  **`resumeId` 让模型记得，这个让你看得见** —— 两者缺一不可：只有 resumeId 时，
   *  重启后界面是空的、一发消息模型却接着上次说，人会以为它在乱答。
   *  存取见 main/agentHistory.ts，裁剪与「卡在 running 的命令落到 failed」见 ./history.ts。 */
  const [restored, setRestored] = useState<{ turns: Turn[]; resumeId: string | null }>({
    turns: [],
    resumeId: null
  })
  // 用户自己发出去的消息——归约器从不产出它们（见文件头注释），渲染前要自己合并回去。
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])
  // 后续消息（send()）失败时的原因——展示交给 ChatToolbar，这里只持有（它拿着 sessionId）。
  const [sendError, setSendError] = useState<string | null>(null)

  const reducerRef = useRef(createChatReducer())
  const unsubRef = useRef<(() => void) | null>(null)
  /** 空态那个输入框 —— 选完斜杠候选要把焦点还回去 */
  const emptyTaRef = useRef<HTMLTextAreaElement>(null)
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
      cwd
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
        // 默认只选**现在就能用**的：装了 + 支持会话。没有就不预选，
        // 让用户自己点（点到没装的会给安装入口）
        const usable = list.filter((c) => c.available && c.chatSupported)
        // **pane 指定了就用它。** 插件属于哪个 CLI 是确定的（GitHub 是 Codex 的、
        // claude-mem 是 Claude 的），挑错家伙 = 那个插件的工具在会话里根本不存在。
        // 指定的那个没装 / 不支持会话时退回既有逻辑，不是硬失败——
        // 用户至少还能看到界面并自己换一个。
        const pinned = pinnedCli ? usable.find((c) => c.id === pinnedCli) : undefined
        // 规矩连同 5 条单测在 `pickCli.ts`：随包那个排最后，但**别人都没装时就用它**。
        // 摘出去是因为它决定用户打开软件看到的第一个 agent，写反了每个人都撞得上，
        // 而写在 effect 里测不到。
        setSelected((cur) => cur ?? pickDefaultCli(usable, pinned, readLastCli()))
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

  /** override：派活时直接把任务传进来 —— 不走 state，因为同一帧里 setText 还没生效 */
  /** 把这个视图接到一个会话的事件流上。
   *
   *  **两条路共用**：自己 start 起来的（handleSend），和接管一个已经在跑的
   *  （团队面板点进来 —— 那个 agent 的画布节点可能早被关掉了，进程却还在跑）。
   *
   *  preload 从模块加载期就按 sessionId 缓冲事件，这里订阅时会先回放攒下的再转实时，
   *  所以接管一个跑到一半的会话不会只看到「从现在开始」的半截输出。 */
  const attachTo = (sid: string): void => {
    unsubRef.current?.()
    unsubRef.current = window.api.agentChat.onEvent(sid, (e: ChatEvent) => {
      reducerRef.current.push(e)
      if (!aliveRef.current) return
      // session.ready 带的是 **CLI 自己的**会话 id（session.ts 拿它填 SessionRecord.resumeId）。
      // 写回 PaneState → 随 canvas.json 落盘 → 下次打开这个节点接得上上下文。
      // 每轮都会来一次，setAgentResumeId 里对相同值直接返回原对象，不会白白制造新状态。
      if (e.k === 'session.ready' && e.sessionId) setAgentResumeId(tabId, leafId, e.sessionId)
      const v = reducerRef.current.view()
      setView(v)
      // ── 接进全局的通知系统 ──────────────────────────────────────
      // 运行监视 / 待处理列表 / 灵动岛 / 提示音 / 侧栏与抽屉的项目状态点，
      // 全都读 runningPtys + attentionPtys 这两份信号（machine.ts 的 statusOf）。
      // 终端那边由 TerminalView 按标题 spinner 的起落写入；AI 对话这边就是
      // turn.start / turn.done —— 语义完全对得上，不需要新造一套通知机制。
      //
      // **这两个 action 的参数名叫 ptyId 是历史包袱**，它们要的其实是「任务 id」；
      // 这里传会话 id，machine.locate 已经认得（见那边的说明）。
      const st = useStore.getState()
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
  const handleNewChat = (): void => {
    if (!nodeRef) return
    const [fid, nid] = nodeRef.split('|')
    if (!fid || !nid) return
    if (sessionId) window.api.agentChat.stop(sessionId)
    unsubRef.current?.()
    unsubRef.current = null
    setAgentSessionId(tabId, leafId, '')
    setAgentResumeId(tabId, leafId, '')
    useStore.getState().startNewChat(fid, nid)
    // 本地状态全部回到「这个节点刚建出来」的样子。
    // **reducer 也要换新的** —— 不换的话上一段的轮次还留在里面，
    // 新会话第一个事件会接在旧对话后面。
    reducerRef.current = createChatReducer()
    adoptedRef.current = false
    setSessionId(null)
    setView(null)
    setRestored({ turns: [], resumeId: null })
    setSentMessages([])
    setSendError(null)
    setText('')
  }

  const handleSend = async (override?: string): Promise<void> => {
    // override 是程序性发送（空态卡片上的「接上上次的对话」那种），不该带上 chip；
    // 用户自己按发送才展开挂着的提示词
    const expanded = override !== undefined ? null : expandChips(text, chips)
    const message = override !== undefined ? override.trim() : expanded!.text
    if (!message || !selected || starting || sessionId) return
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
      result = await window.api.agentChat.start({
        cli: selected.id,
        cwd,
        message,
        skipApprovalHook,
        askFirst,
        // 角色契约。**两处 start 都要带** —— 漏掉哪条路径，
        // 走那条路开出来的会话就没有角色（同 identity 那条注释的理由）。
        ...(roleContract ? { roleContract } : {}),
        ...(roleTools ? { roleTools } : {}),
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
          cli: selected.id,
          cwd,
          message,
          skipApprovalHook,
          askFirst,
          // 这条是「带着旧会话 id 起不来 → 清掉重来」的重试路径。
          // **角色同样要带** —— 漏掉的话，撞上一次重试就悄悄丢了角色，
          // 而用户什么都看不出来（界面上角色还显示着）。
          ...(roleContract ? { roleContract } : {}),
          ...(roleTools ? { roleTools } : {}),
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
    () => requestAnimationFrame(() => emptyTaRef.current?.focus()),
    cwd,
    emptyTaRef,
    // 预加载的 chip 也进 `@` 候选，且排在文件前面
    chips
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
    setRestored({ turns, resumeId: got.resumeId })
    if (h.resumeId) setAgentResumeId(tabId, leafId, h.resumeId)
    setOrphans([])
    // 立刻把它写到新 leafId 名下 —— 不等 view，那要等用户发消息才有。
    const saved = await window.api.agentChat
      .saveHistory(histKey, trimForSave(turns), h.resumeId ?? got.resumeId ?? null, cwd)
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
    const handleFollowupSend = async (
      message: string,
      meta?: { text: string; images: { path: string; url: string }[] }
    ): Promise<boolean> => {
      const trimmed = message.trim()
      if (!trimmed) return false
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
      setSentMessages((prev) => [...prev, entry])
      const r = await window.api.agentChat
        .send(sessionId, trimmed)
        .catch((e): { ok: false; error: string } => ({
          // IPC 本身 reject（会话不存在之外的意外）以前是一条 unhandled rejection，
          // 界面上什么都不会发生、消息却已经显示在对话流里——跟 I4 是同一个失败面，
          // 顺手在这条路径上接住。
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        }))
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
      if (aliveRef.current) setSendError(r.error)
      return false
    }
    return (
      <div className="agent-chat-view">
        <MessageList
          view={displayView}
          onApprovalDecide={handleApprovalDecide}
          leafId={leafId}
          // 会话在跑：走追问那条路（乐观插入 + 失败把字放回输入框）
          onPickOption={(t) => void handleFollowupSend(t)}
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
          approvalHook={selected!.approvalHook}
          view={displayView}
          cwd={cwd}
          onNewChat={handleNewChat}
          sessionId={sessionId}
          onSend={handleFollowupSend}
          roleId={roleId}
          // ── 换角色 = 结束当前会话重开（用户 2026-09-03 在 (a)(b)(c) 里选了 b）──
          //
          // 角色契约走系统提示，那条 flag **只在 spawn 时传一次** —— 会话跑起来之后
          // 改不了。三条路里选 b 的理由：角色不是「参数」是「换了个人」，
          // 半路换掉而上下文还是旧的，比重开更让人困惑。
          //
          // **确认之后走的是既有的「新对话」那条路**，不另写一条结束会话的代码 ——
          // 那条路上有乐观插入撤回、麦克风收音、resumeId 记账，各自都有事故史。
          onPickRole={(next) => {
            const name = roles.find((r) => r.id === next)?.name ?? '无角色'
            requestConfirm({
              message: `换成「${name}」会结束当前会话重新开始，之后的消息不再带着现在的上下文。旧的对话记录不会删除，之后能从空态的「接上上次的对话」里找回来。继续吗？`,
              confirmLabel: '换角色并重开',
              onConfirm: () => {
                setAgentRole(tabId, leafId, next)
                handleNewChat()
              }
            })
          }}
          onSetParams={(patch) => void window.api.agentChat.setParams(sessionId, patch)}
          sendError={sendError}
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
              cli={setupFor.cli}
              onCancel={() => setSetupFor(null)}
              onDone={() => {
                setSetupFor(null)
                // **重新问主进程，不在这里自己拼一个 `loggedIn: true`。**
                // omp 那边的「就绪」是「选了模型 ＋ 冒烟通过」合起来算出来的，
                // 渲染层臆造一个 true 会跟它对不上（面板说好了、闸门还拦着，或反过来）。
                void probeOmp().then((st) => {
                  if (aliveRef.current) setAuth(st)
                })
              }}
            />
          ) : (
            <CliSetupPanel
              cliId={setupFor.cli.id as 'claude' | 'codex'}
              displayName={setupFor.cli.displayName}
              installCmd={setupFor.cli.installCmd}
              // `from: 'install'` 只会在用户**自己点了一个没装的 CLI** 时置起
              // （唯一置起点在上面那个 pickCliAndSetup）。那一下就是他的确认，
              // 所以不再停在「摆着命令等你点开始」那一屏。
              autoStart={setupFor.from === 'install'}
              from={setupFor.from}
              onCancel={() => setSetupFor(null)}
              onDone={(status) => {
                setAuth((cur) => (cur ? { ...cur, status } : cur))
                setSetupFor(null)
              }}
            />
          ))}
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
            {/* 这个项目里还留着、但节点已经关掉的对话。**不自动带进来** ——
                那是别的对话框的内容，替用户决定接上哪一段是越权；给入口、他自己挑。
                只列最近 3 条，再多就成了历史管理界面，不是这里该干的事。 */}
            {orphans.length > 0 && (
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
          </>
        )}

        {/* 输入框**上方**的一行上下文：在哪个目录跑、用哪个 CLI。
            照 DeepSeek Harness 那套布局来（用户 2026-08-19 指定）——「这次对话的前提」
            排在输入框上面，「这条消息怎么发」排在输入框里面，两类东西不再混在一起。 */}
        <div className="ac-ctxbar">
          <span className="ac-ctxbar-item" data-tip={cwd}>
            <FolderIcon size={12} />
            <span className="ac-ctxbar-name">{cwd.split('/').filter(Boolean).pop() ?? cwd}</span>
          </span>
          <button
            type="button"
            className="ac-ctxbar-item as-btn"
            onClick={(e) => openCliMenu(e)}
            disabled={phase.k === 'starting' || !clis?.length}
            data-tip="换一个 CLI"
          >
            <SparkleIcon size={12} />
            <span className="ac-ctxbar-name">
              {selected?.displayName ?? (phase.k === 'detecting' ? '检测中…' : '选一个 CLI')}
            </span>
            <ChevronDownIcon size={10} />
          </button>
        </div>
        {/* 发送做成输入框右下角的图标，不再是底下那个独立的文字按钮：
            它就该长在输入框上，视线不用离开正在打字的地方。 */}
        {/* **有历史时用对话态的输入框尺寸。**
            两者的视觉（圆角/边/底）本来就是同一套，差的是**宽度与留白**：
            空态是 `min(560px)` 居中的高框 —— 那是「从零开始」该有的样子，
            大而居中，请你说第一句话。
            但有历史时上面已经摆着满屏对话了，再来一个居中大框，
            看着像是「另起一个新会话」而不是「接着上面聊」。
            用户 2026-09-02：「希望输入框保持和启动的时候样式一致。」 */}
        <div className={`ac-input-wrap${restored.turns.length > 0 ? ' resumed' : ''}`}>
          {emptySlash.open && <SlashList {...emptySlash} />}
          {chips.length > 0 && (
            <div className="ac-attach-row in-empty">
              {chips.map((c) => (
                <span
                  className={`ac-chip${refIds.includes(c.id) ? '' : ' idle'}`}
                  key={c.id}
                  data-tip={c.text}
                >
                  <DictIcon size={11} />
                  <span className="ac-chip-label">{c.label}</span>
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
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={emptyTaRef}
            className="ac-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            // 聚焦时把「往这儿追加」登记到 store，名词词典点条目就插进这里而不是终端。
            // 在 onFocus 里注册而不是 mount 时：拿到的一定是当前这次渲染的 setText，
            // 也天然表达了「最后聚焦的是我」。
            onFocus={() => {
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
                isComposing: e.nativeEvent.isComposing }
              if (!isSendKey(k)) return
              if (shouldPreventDefault(k)) e.preventDefault()
              void handleSend()
            }}
            placeholder={`跟 AI 说点什么…（${SEND_HINT}）`}
            rows={3}
            autoFocus
            disabled={phase.k === 'starting'}
          />
          {/* 输入框**内部底边**的一条：这次消息怎么发。照 DeepSeek 那套布局，
              「前提」（目录 / CLI）在框上方，「这条怎么发」在框里面。
              麦克风保留（用户 2026-08-19 特别交代），跟发送并排在右下角。 */}
          <div className="ac-input-bar">
            <span className="ac-input-bar-spacer" />
            <VoiceButton ptyId={`agent-empty-${leafId}`} inline onText={(t) => setText((v) => (v ? v + t : t))} />
            <button
              type="button"
              className="ac-input-send"
              data-tip={phase.k === 'starting' ? '正在启动会话…' : `发送（${SEND_HINT}）`}
              onClick={() => void handleSend()}
              disabled={(!text.trim() && !chips.length) || phase.k !== 'ready'}
            >
              {phase.k === 'starting' ? (
                <span className="ac-dot" aria-hidden="true" />
              ) : (
                <SendIcon size={15} />
              )}
            </button>
          </div>
        </div>
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
        {(phase.k === 'detecting' || phase.k === 'none') && (
          <div className="ac-clis-hint">
            {phase.k === 'detecting' ? '正在检测可用的 CLI…' : '没有可用的 CLI'}
          </div>
        )}
        {/* ── 登录闸门 ────────────────────────────────────────────────
            **摆在输入框下面而不是替换掉它**：用户可能已经打了半屏字，
            把输入框换掉等于把那些字藏起来（回来还得重打）。
            让他照常打、照常按发送，handleSend 拦一下把这块展开就够了。 */}
        {/* **闸门和灯箱不再是二选一。** 灯箱现在 portal 到 body、盖在整个窗口上，
            闸门留在原地就好 —— 关掉灯箱时它还在，用户知道自己回到了哪儿。
            （改成灯箱之前这里是三元表达式，灯箱一开闸门就消失，
            关掉灯箱那一瞬间闸门又跳回来，闪一下） */}
        {blockedByAuth && (
          <div className="ac-authgate">
            {/* **两支文案按 `auth` 能力位分，不按 CLI 名字。**
                omp 这一支说的是完全不同的一件事：它没有账号、没有浏览器授权，
                拦住人的是「还没选服务商 / 还没填 key」。照搬「还没登录」的原文案
                会把人推去找一个根本不存在的登录入口。
                原文案原样留给 `cli-login`（也留给所有不声明这个字段的老 adapter）。 */}
            {selected?.auth === 'provider-key' ? (
              <span>
                <b>{selected.displayName}</b> 还没配好。选一家模型服务商，用你已经买的
                订阅登录、或者填一把 API key —— 两条都行，全程在这里完成。
              </span>
            ) : (
              <span>
                <b>{selected?.displayName}</b> 还没登录。登录之后才能开始对话 ——
                整个过程在这里完成，不用去终端。
              </span>
            )}
            <button
              type="button"
              className="ac-authgate-go"
              onClick={() => selected && setSetupFor({ cli: selected, from: 'login' })}
            >
              {selected?.auth === 'provider-key' ? '去设置' : '点我去登录'}
            </button>
          </div>
        )}
        {/* 正在查登录状态时给一句 —— 冷启的 CLI 要一两秒，没有这句会像卡住了。
            omp 那支查的是「配好了没有」而不是「登没登录」，措辞跟着 `auth` 走。 */}
        {authChecking && !setupFor && !blockedByAuth && (
          <div className="ac-clis-hint">
            正在确认 {selected?.displayName} 的
            {selected?.auth === 'provider-key' ? '配置状态' : '登录状态'}…
          </div>
        )}
        {setupFor &&
          // 分支理由同对话态那处：**排除式**，只有 `provider-key` 走 omp，
          // 其余一切（含所有不声明这个字段的老 adapter）原样走 CliSetupPanel。
          (setupFor.cli.auth === 'provider-key' ? (
            <OmpSetupPanel
              cli={setupFor.cli}
              onCancel={() => setSetupFor(null)}
              onDone={() => {
                setSetupFor(null)
                // 和登录那支一样：**就地重查一次**，不等下一次 effect ——
                // 那个 effect 依赖 [selected, sessionId]，配完 key 这两个都没变，
                // 不主动更新的话闸门会一直挂着，人配完了还被挡着发不出去。
                // 用重查而不是自己拼 true 的理由见对话态那处的注释。
                void probeOmp().then((st) => {
                  if (aliveRef.current) setAuth(st)
                })
              }}
            />
          ) : (
            <CliSetupPanel
              cliId={setupFor.cli.id as 'claude' | 'codex'}
              displayName={setupFor.cli.displayName}
              installCmd={setupFor.cli.installCmd}
              // `from: 'install'` 只会在用户**自己点了一个没装的 CLI** 时置起
              // （唯一置起点在上面那个 pickCliAndSetup）。那一下就是他的确认，
              // 所以不再停在「摆着命令等你点开始」那一屏。
              autoStart={setupFor.from === 'install'}
              from={setupFor.from}
              onCancel={() => setSetupFor(null)}
              onDone={(status) => {
                // 登录成功：把闸门放下，并**就地更新 auth**，不等下一次 effect ——
                // 那个 effect 依赖 [selected, sessionId]，登录并不改变这两个，
                // 不手动更新的话闸门会一直挂着，用户登完了还被挡着发不出去
                setAuth((cur) => (cur ? { ...cur, status } : cur))
                setSetupFor(null)
              }}
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
        {cliNote && (
          <div className="ac-cli-note">
            {!cliNote.available ? (
              <>
                <b>{cliNote.displayName}</b> 还没装。
                {cliNote.installCmd ? (
                  <>
                    {' '}
                    点下面这行会问你要不要现在装。
                    <button className="ac-cli-cmd" onClick={() => installCli(cliNote)}>
                      <code>{cliNote.installCmd}</code>
                    </button>
                  </>
                ) : (
                  ' 请到它的官网安装。'
                )}
              </>
            ) : (
              <>
                <b>{cliNote.displayName}</b> 已安装，但{cliNote.scopeNote ?? '不能用于 AI 对话'}。
                在终端里直接敲 <code>{cliNote.id}</code> 就能用。
              </>
            )}
            <button className="ac-cli-note-x" onClick={() => setCliNote(null)}>
              ×
            </button>
          </div>
        )}
        {phase.k === 'failed' && <div className="ac-error">{phase.error}</div>}
      </div>
    </div>
  )
}
