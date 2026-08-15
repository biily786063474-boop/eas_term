// 通用 AI CLI 对话节点：空态起会话 + 对话态占位。
//
// 空态与对话态是**同一个组件的两个阶段**，不是两个组件——sessionId 一拿到就切阶段，
// 组件本身不重新挂载，事件订阅不会因为切阶段被打断（本文件正文见 task-3-brief.md）。
//
// 空态只做三件事：选 CLI（数据来自 Task 0 的 listClis，只有 detect() 探测到的才显示）、
// 输入首条消息、起会话。真正的对话流渲染是 Task 4 的事，这里只留一个占位——但订阅
// 已经真的接上了：事件从 start() 一返回就被喂进归约器，Task 4 直接读 view 状态即可，
// 不用重新接线。
//
// **不允许按 CLI 名字分支**：CLI 选项、它的能力声明，全部来自 listClis() 原样透传的
// CliInfo，选项按钮只认 id/displayName，不认「是不是 claude」。
import { useEffect, useRef, useState } from 'react'
import type { AgentChatStartResult, ChatEvent, CliInfo } from '../../../../shared/agentChat.ts'
import { createChatReducer, type ChatView } from './reduce.ts'
import { SparkleIcon } from '../../ui/Icons'
import { useStore } from '../../store'
import './agentChat.css'

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
    let result: AgentChatStartResult
    try {
      // message 必填直接带上，不留到之后再 send()——Codex 的 exec 要靠它作为启动时的
      // 位置参数，没法「先开会话、再补第一条」；Claude 那边 start() 内部也已经把它
      // 当第一条写进 stdin 了，这里不需要（也不能）再调一次 send() 重复投递同一条消息。
      result = await window.api.agentChat.start({ cli: selected.id, cwd, message })
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
    // 尽快订阅，别拖到下一次交互。start() 在 preload 里已经从 invoke resolve 那一刻起
    // 开始缓冲事件，这里订阅时会先回放缓冲区再转实时，所以不会丢首事件。
    unsubRef.current = window.api.agentChat.onEvent(result.sessionId, (e: ChatEvent) => {
      reducerRef.current.push(e)
      if (aliveRef.current) setView(reducerRef.current.view())
    })
    setSessionId(result.sessionId)
    setStarting(false)
    setText('')
  }

  // 对话态：占位。真正的消息流渲染是 Task 4 的事——这里只证明订阅确实接上了
  // （轮次数 / 忙碌态会跟着事件实时变化）。
  if (sessionId) {
    return (
      <div className="agent-chat-view">
        <div className="ac-placeholder">
          <SparkleIcon size={16} />
          <span>
            会话已开始 · {selected?.displayName ?? ''} · {view?.turns.length ?? 0} 条消息
            {view?.busy ? ' · 处理中…' : ''}
          </span>
        </div>
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
