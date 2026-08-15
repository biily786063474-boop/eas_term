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
import './agentChat.css'

export function AgentChatView({ cwd }: { cwd: string }): JSX.Element {
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
    if (!aliveRef.current) return // 面板已经被切走/关掉，会话留给主进程自己管
    if (!result.ok) {
      setStarting(false)
      setStartError(result.error)
      return
    }
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
