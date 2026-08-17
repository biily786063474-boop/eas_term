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
import { usesApprovalHookFile } from './toolbarModel.ts'
import type { ApprovalDecision } from './ApprovalCard'
import { MessageList } from './MessageList'
import { ChatToolbar } from './ChatToolbar'
import { SparkleIcon } from '../../ui/Icons'
import { useStore } from '../../store'
import './agentChat.css'

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
}

function mergeUserMessages(view: ChatView, sent: SentMessage[]): ChatView {
  if (sent.length === 0) return view
  const merged: Turn[] = []
  let sentIdx = 0
  for (let i = 0; i <= view.turns.length; i++) {
    while (sentIdx < sent.length && sent[sentIdx].beforeTurnCount === i) {
      merged.push({ role: 'user', text: sent[sentIdx].text, execs: [] })
      sentIdx += 1
    }
    if (i < view.turns.length) merged.push(view.turns[i])
  }
  return { ...view, turns: merged }
}

// 会话刚起、任何事件都还没到达时 view 是 null（onEvent 至少要等第一个事件才会 setView）。
// 这段真空期用户已经能看到自己刚发的那条消息，不能因为 view 还是 null 就整屏空白——
// busy 给 true 是合理的默认值：start() 已经 resolve、进程正在跑，只是还没吐出第一个事件。
const EMPTY_VIEW: ChatView = { turns: [], pending: null, notices: [], usage: null, costUsd: undefined, busy: true }

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
  // null = 还没拉回来（探测中）；[] = 拉回来了但一个可用的都没有
  const [clis, setClis] = useState<CliInfo[] | null>(null)
  // 选中的整条 CliInfo（不只是 id）——capabilities 跟着一起存下来，供工具栏用（Task 6）
  const [selected, setSelected] = useState<CliInfo | null>(null)
  const [text, setText] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [view, setView] = useState<ChatView | null>(null)
  // 用户自己发出去的消息——归约器从不产出它们（见文件头注释），渲染前要自己合并回去。
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])
  // 后续消息（send()）失败时的原因——展示交给 ChatToolbar，这里只持有（它拿着 sessionId）。
  const [sendError, setSendError] = useState<string | null>(null)
  // 审批 hook 首次安装前的询问卡片（Task 7 / Ruling 15）。resolve 由用户点击卡片按钮触发，
  // 见 handleSend 里 `new Promise<boolean>` 那段——卡片本身只是这个 Promise 的 UI 外壳。
  const [hookAsk, setHookAsk] = useState<{
    cliName: string
    configPath: string
    resolve: (v: boolean) => void
  } | null>(null)

  const reducerRef = useRef(createChatReducer())
  const unsubRef = useRef<(() => void) | null>(null)
  // 防止「起会话」这次 await 还没回来、面板已经被切走/关掉——回来后不再 setState，
  // 也不再订阅一个已经没人看的会话（会话本身照样在主进程活着，不受这里影响）
  const aliveRef = useRef(true)

  useEffect(
    () => () => {
      aliveRef.current = false
      unsubRef.current?.()
    },
    []
  )

  // 空态：拉一次可用 CLI 列表——只渲染 detect() 探测通过的那些，没装的不出现，
  // 免得用户选了一个点了就报错的选项。
  useEffect(() => {
    let cancelled = false
    window.api.agentChat
      .listClis()
      .then((list) => {
        if (cancelled) return
        const available = list.filter((c) => c.available === true)
        setClis(available)
        // 默认选中第一个可用的——没有默认值的话每次都要多点一下才能发消息
        setSelected((cur) => cur ?? available[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setClis([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSend = async (): Promise<void> => {
    const message = text.trim()
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
    let skipApprovalHook = false
    if (usesApprovalHookFile(selected.approvalHook)) {
      let status: AgentApprovalHookStatus
      try {
        status = await window.api.agentChat.hookStatus(cwd)
      } catch {
        // 查询本身失败：判不出状态时不卡用户，直接放行——跟内核 Ruling 14 同一个哲学
        // （告知而非阻断）；真正没装成功的话，start() 之后也会有一条 notice 兜底。
        status = { installed: true, outdated: false, configPath: '' }
      }
      if (!aliveRef.current) return
      if (!status.installed) {
        const proceed = await new Promise<boolean>((resolve) => {
          // configPath 优先用后端算出来的那份（hookConfigPath(cwd)，session.ts）——
          // 那是真正会被写入的路径；查询失败的兜底对象里它是空串，这时候才退回
          // 自己拼一份好看的路径，纯粹是不想在卡片上开天窗。
          setHookAsk({ cliName: selected.displayName, configPath: status.configPath || `${cwd}/.claude/settings.json`, resolve })
        })
        setHookAsk(null)
        if (!aliveRef.current) return
        // proceed=false（点了「这次不装，直接开始」）→ 会话仍然要起，只是带上这个标记，
        // 让 restartAndDeliver 跳过装 hook 并改推一条"这次没有保护"的 notice。
        skipApprovalHook = !proceed
      }
    }

    let result: AgentChatStartResult
    try {
      // message 必填直接带上，不留到之后再 send()——Codex 的 exec 要靠它作为启动时的
      // 位置参数，没法「先开会话、再补第一条」；Claude 那边 start() 内部也已经把它
      // 当第一条写进 stdin 了，这里不需要（也不能）再调一次 send() 重复投递同一条消息。
      result = await window.api.agentChat.start({ cli: selected.id, cwd, message, skipApprovalHook })
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
    unsubRef.current = window.api.agentChat.onEvent(result.sessionId, (e: ChatEvent) => {
      reducerRef.current.push(e)
      if (aliveRef.current) setView(reducerRef.current.view())
    })
    // beforeTurnCount 取当前归约器已有的轮次数——此刻订阅刚接上、一个事件都还没喂进去，
    // 必然是 0，但按公式算而不是硬编码 0：这条消息永远紧挨着插在它触发的第一个
    // assistant 轮次之前，跟 mergeUserMessages 的合并逻辑对齐。
    setSentMessages((prev) => [...prev, { text: message, beforeTurnCount: reducerRef.current.view().turns.length }])
    setSessionId(result.sessionId)
    setStarting(false)
    setText('')
  }

  // 对话态：MessageList 渲染真正的消息流（Task 4），审批卡片挂在里面（Task 5）。
  if (sessionId) {
    // resolveApproval 需要 sessionId——ApprovalCard/MessageList 都不持有它（各自的
    // 声明式 props 只有 pending/onDecide、view/onApprovalDecide），IPC 调用统一收在
    // 这个组件里，跟 start()/onEvent 用同一个「谁持有 sessionId 谁管 IPC」的分工。
    const handleApprovalDecide = (approvalId: string, decision: ApprovalDecision): void => {
      void window.api.agentChat.resolveApproval(sessionId, approvalId, decision)
    }
    const displayView = mergeUserMessages(view ?? EMPTY_VIEW, sentMessages)
    // 后续消息：首条已经在 start() 里投递过了（见文件头 handleSend 的注释），这里走
    // send(sessionId, text)。beforeTurnCount 的算法跟首条消息完全一致——reducerRef 的
    // turns 只增不减，所以在这里现读它的长度、跟 mergeUserMessages 的插入位置对齐，
    // 不会因为这是「第 N 条」而需要不同的公式（上一轮审查点名过这条不变量，见任务交底）。
    const handleFollowupSend = (message: string): void => {
      const trimmed = message.trim()
      if (!trimmed) return
      setSendError(null)
      const beforeTurnCount = reducerRef.current.view().turns.length
      setSentMessages((prev) => [...prev, { text: trimmed, beforeTurnCount }])
      void window.api.agentChat.send(sessionId, trimmed).then((r) => {
        if (!r.ok && aliveRef.current) setSendError(r.error)
      })
    }
    return (
      <div className="agent-chat-view">
        <MessageList view={displayView} onApprovalDecide={handleApprovalDecide} />
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

  // 空态：居中 logo + 多行输入框 + CLI 选择器
  return (
    <div className="agent-chat-view">
      <div className="ac-empty">
        <div className="ac-logo">
          <SparkleIcon size={30} />
        </div>
        <textarea
          className="ac-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          placeholder="跟 AI 说点什么…（Enter 发送，Shift+Enter 换行）"
          rows={3}
          autoFocus
          disabled={starting}
        />
        <div className="ac-clis">
          {clis === null && <span className="ac-clis-hint">正在检测可用的 CLI…</span>}
          {clis !== null && clis.length === 0 && (
            <span className="ac-clis-hint">没有探测到可用的 CLI —— 请先安装 Claude Code 或 Codex</span>
          )}
          {clis?.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`ac-cli-chip${c.id === selected?.id ? ' selected' : ''}`}
              onClick={() => setSelected(c)}
              disabled={starting}
            >
              {c.displayName}
            </button>
          ))}
        </div>
        {/* 审批 hook 首次安装前的询问（Task 7 / Ruling 15）——复用 ApprovalCard 那一套
            视觉语言（.ac-approval*），这也是一次「要不要授权」的决定，没必要另起一套样式。
            不用全局 ConfirmDialog：那个组件的确认按钮固定是 .danger-btn（红色，为「压缩
            上下文」这类破坏性操作设计），套在「开启保护」这个正向操作上会传错信号。 */}
        {hookAsk && (
          <div className="ac-approval ac-hook-ask">
            <div className="ac-approval-title">开启审批保护？</div>
            {/* 拼成一个模板字符串表达式，不写成跨行的 JSX 原始文本——JSX 会把文本节点里
                跨行的空白折叠成一个空格，中文没有词间空格，跨行处会被硬生生插进一个空格
                （实测会把「修改文件」拆成「修改 文件」），拼字符串就没有这个问题。
                两个按钮都要能让人做决定，不是「同意/取消」二选一——不装同样能正常开始
                对话，只是没有逐次审批，文案要把两条路的后果都讲清楚（协调方原话）。 */}
            <div className="ac-hook-ask-body">
              {`「${hookAsk.cliName}」支持在这个项目里装一个审批钩子——装上之后，它每次要执行命令或修改文件前都会先弹卡片，等你点"允许"才会继续；只影响这一个项目（写在 ${hookAsk.configPath}），随时可以在工具栏一键卸载。不装的话对话照常开始，但工具调用会按默认权限直接执行、不会等你确认，界面会用一条提醒告诉你这次没有保护。`}
            </div>
            <div className="ac-approval-actions">
              <button type="button" className="ac-approval-btn deny" onClick={() => hookAsk.resolve(false)}>
                这次不装，直接开始
              </button>
              <button type="button" className="ac-approval-btn allow" onClick={() => hookAsk.resolve(true)}>
                装上（推荐）
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          className="ac-send"
          onClick={() => void handleSend()}
          disabled={!text.trim() || !selected || starting}
        >
          {starting ? '启动中…' : '发送'}
        </button>
        {startError && <div className="ac-error">{startError}</div>}
      </div>
    </div>
  )
}
