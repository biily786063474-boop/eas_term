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
import { useEffect, useRef, useState } from 'react'
import type {
  AgentApprovalHookStatus,
  AgentChatStartResult,
  ChatEvent,
  CliInfo
} from '../../../../shared/agentChat.ts'
import { createChatReducer, type ChatView, type Turn } from './reduce.ts'
import { trimForSave, settleOnLoad, contextLostOf } from './history.ts'
import { startupPhaseOf } from './startupPhase.ts'
import { usesApprovalHookFile } from './toolbarModel.ts'
import type { ApprovalDecision } from './ApprovalCard'
import { MessageList } from './MessageList'
import { ChatToolbar } from './ChatToolbar'
import { SendIcon, FolderIcon, SparkleIcon, ChevronDownIcon } from '../../ui/Icons'
import { CanvasContextMenu, type CanvasMenuItem } from '../canvas/CanvasContextMenu'
import { VoiceButton } from '../voice/VoiceButton'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import './agentChat.css'
import { isSendKey, shouldPreventDefault, SEND_HINT } from './sendKey'

/** 归约器（reduce.ts）**从不产出 `Turn.role: 'user'`**——内核的事件流里没有「用户消息」
 *  事件，CLI 不回显用户输入。用户自己发出去的文本在渲染层是同步已知的（按下发送那一刻
 *  就知道），这里单独维护一份、渲染前合并进归约器的 turns，否则界面上只有 AI 在自言自语。
 *
 *  beforeTurnCount 记录「这条消息发出那一刻，归约器已经产出了几个 assistant 轮次」——
 *  合并时用它决定这条用户消息该插在哪两个 assistant 轮次之间。turns 只增不减、不重排
 *  （reduce.ts 的 text.done/exec.start 只 push，不 splice），所以这个计数在整段会话里
 *  稳定：一条用户消息永远紧挨着插在它触发的那个 assistant 轮次之前，无论后面又新增了
 *  多少轮次都不会被顶到别的位置。 */
interface SentMessage {
  text: string
  beforeTurnCount: number
  /** 这条消息带的图（缩略图，只为界面预览）。发给 CLI 的是路径，不是这个 */
  images?: { path: string; url: string }[]
}

function mergeUserMessages(view: ChatView, sent: SentMessage[]): ChatView {
  if (sent.length === 0) return view
  const merged: Turn[] = []
  let sentIdx = 0
  for (let i = 0; i <= view.turns.length; i++) {
    while (sentIdx < sent.length && sent[sentIdx].beforeTurnCount === i) {
      merged.push({ role: 'user', text: sent[sentIdx].text, execs: [], images: sent[sentIdx].images })
      sentIdx += 1
    }
    if (i < view.turns.length) merged.push(view.turns[i])
  }
  return { ...view, turns: merged }
}

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
      .loadHistory(leafId)
      .then((h) => {
        if (alive) setRestored({ turns: settleOnLoad(h.turns as Turn[]), resumeId: h.resumeId })
      })
      // 读不到就当没有历史。**不能让它挡住对话框起来** —— 这只是个锦上添花的功能
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [leafId])

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
  const clearInitialMessage = useStore((s) => s.clearAgentInitialMessage)
  // null = 还没拉回来（探测中）；[] = 拉回来了但一个可用的都没有
  const [clis, setClis] = useState<CliInfo[] | null>(null)
  /** 点了一个不能直接用的 CLI（没装 / 仅终端）时，下面显示的说明 */
  const [cliNote, setCliNote] = useState<CliInfo | null>(null)
  const prefillTerminal = useStore((s) => s.prefillTerminal)

  /** 把安装命令填进终端。**不代跑** —— 静默装全局 CLI + 改 PATH 是恶意软件的
   *  行为特征，会被 Gatekeeper / Defender 盯上（agentInstall.ts 的既有纪律）。
   *  填进去之后用户看得见、能改、自己按回车。 */
  const installCli = async (c: CliInfo): Promise<void> => {
    if (!c.installCmd) return
    setCliNote(null)
    await prefillTerminal(c.installCmd)
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
      onClick: () => (usable ? setSelected(c) : setCliNote(c))
    }
  })
  const [text, setText] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
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

  // 聊天记录落盘。节流 1 秒：流式输出时 view 每个 token 都在变，不节流会把磁盘写爆。
  // **依赖里放 view 而不是 displayView** —— 后者只在 sessionId 有值的分支里算得出来，
  // 而 hook 不能放在条件分支里。
  useEffect(() => {
    const turns = view?.turns
    if (!turns?.length) return
    const t = window.setTimeout(() => {
      void window.api.agentChat
        .saveHistory(leafId, trimForSave([...restored.turns, ...turns]), savedResumeId || null, cwd)
        .catch(() => undefined)
    }, 1000)
    return () => window.clearTimeout(t)
  }, [view, restored, leafId, savedResumeId, cwd])

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
        setSelected((cur) => cur ?? usable[0] ?? null)
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
  const handleSend = async (override?: string): Promise<void> => {
    const message = (override ?? text).trim()
    if (!message || !selected || starting || sessionId) return
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
        ...identity,
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
    // 面板已经被切走/关掉：不再订阅事件、不再 setState，但会话已经能从 store 里
    // 追踪到了，killPanePty 收得到——上面那句写回不受这里提前 return 的影响。
    if (!aliveRef.current) return
    // 尽快订阅，别拖到下一次交互。首事件不会丢，但**理由已经变了**（2026-08-17 最终
    // 评审 C1）：不再是"start() 一 resolve 就开始缓冲"——那条时序假设是错的，主进程在
    // handler 返回前就同步推完了首批事件。现在 preload 从模块加载期就挂着一个常驻监听器
    // 按 sessionId 缓冲，这里订阅时把攒下的先回放再转实时（见 preload/index.ts 的
    // AGENT_CHAT_EVENT_CHANNEL 一节）。
    const sid = result.sessionId
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
        // 一轮跑完就标记「有结果等你看」。**不判有没有聚焦**——跟终端那边一致
        //（TerminalView 在 spinner 落下时也是无条件 flagAttention），
        // 清除交给「用户真的去看了」那条路：点灵动岛/待处理列表会走 focusTerminal，
        // 直接点画布上的节点会走 CanvasStage 那个单选 effect。
        if (e.k === 'turn.done') st.flagAttention(sid)
      }
    })
    // beforeTurnCount 取当前归约器已有的轮次数——此刻订阅刚接上、一个事件都还没喂进去，
    // 必然是 0，但按公式算而不是硬编码 0：这条消息永远紧挨着插在它触发的第一个
    // assistant 轮次之前，跟 mergeUserMessages 的合并逻辑对齐。
    setSentMessages((prev) => [...prev, { text: message, beforeTurnCount: reducerRef.current.view().turns.length }])
    setSessionId(result.sessionId)
    setStarting(false)
    setText('')
  }

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
   *  （模型那边才接得上），旧的那份随即删掉，避免同一段对话留两份。 */
  const adoptOrphan = async (h: { leafId: string; resumeId: string | null }): Promise<void> => {
    const got = await window.api.agentChat.loadHistory(h.leafId).catch(() => null)
    if (!got) return
    setRestored({ turns: settleOnLoad(got.turns as Turn[]), resumeId: got.resumeId })
    if (h.resumeId) setAgentResumeId(tabId, leafId, h.resumeId)
    void window.api.agentChat.forgetHistory(h.leafId).catch(() => undefined)
    setOrphans([])
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
      const beforeTurnCount = reducerRef.current.view().turns.length
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
      if (r.ok) return true
      setSentMessages((prev) => prev.filter((m) => m !== entry))
      if (aliveRef.current) setSendError(r.error)
      return false
    }
    return (
      <div className="agent-chat-view">
        <MessageList view={displayView} onApprovalDecide={handleApprovalDecide}  leafId={leafId}/>
        {/* selected 在这里必然非空：走到 sessionId 有值这一步，start() 必然已经过了
            handleSend 顶部 `!selected` 的门槛，且 selected 之后没有任何路径会被清空。 */}
        <ChatToolbar
          caps={selected!.capabilities}
          approvalHook={selected!.approvalHook}
          view={displayView}
          cwd={cwd}
          sessionId={sessionId}
          onSend={handleFollowupSend}
          onSetParams={(patch) => void window.api.agentChat.setParams(sessionId, patch)}
          sendError={sendError}
        />
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
              <div className="ac-restored-hint">上次聊到这里 —— 发一条消息接着聊</div>
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
                <div className="ac-orphans-t">这个项目里还有关掉的对话</div>
                {orphans.slice(0, 3).map((h) => (
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
        <div className="ac-input-wrap">
          <textarea
            className="ac-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
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
              disabled={!text.trim() || phase.k !== 'ready'}
            >
              {phase.k === 'starting' ? (
                <span className="ac-dot" aria-hidden="true" />
              ) : (
                <SendIcon size={15} />
              )}
            </button>
          </div>
        </div>
        {/* 有 resumeId = 这个节点之前聊过。说清楚「接得上什么、接不上什么」——
            上下文在 CLI 那边留着（发第一条就续上），但上面的对话记录没有保存，
            界面从空的开始。不说的话用户会以为记录丢了。 */}
        {savedResumeId && (
          <div className="ac-resume-hint">接着上次的上下文继续（上面的对话记录不保留）</div>
        )}
        {(phase.k === 'detecting' || phase.k === 'none') && (
          <div className="ac-clis-hint">
            {phase.k === 'detecting' ? '正在检测可用的 CLI…' : '没有可用的 CLI'}
          </div>
        )}
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
                    点下面这行会把命令填进终端 —— <b>不会替你执行</b>，你自己按回车。
                    <button className="ac-cli-cmd" onClick={() => void installCli(cliNote)}>
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
