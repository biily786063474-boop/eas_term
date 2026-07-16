import { useCallback, useEffect, useState } from 'react'
import type { SessionTurn, SessionExchange } from '../../../shared/types'
import { MessageIcon, RefreshIcon } from './Icons'

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

// Claude Code 对话导航：读会话 transcript，左列你发的每条消息，点一条 → 右边看消息 + Claude 回答。
// 只读回看（终端拿不到 Claude Code 备用屏的实时滚动，故走它保存的 transcript 文件）。
export function ChatNavView({ cwd }: { cwd: string }): JSX.Element {
  const [found, setFound] = useState(true)
  const [turns, setTurns] = useState<SessionTurn[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [exchange, setExchange] = useState<SessionExchange | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!cwd) {
      setFound(false)
      return
    }
    const idx = await window.api.session.index(cwd)
    setFound(idx.found)
    setTurns(idx.turns)
  }, [cwd])

  useEffect(() => {
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  useEffect(() => {
    if (!selected) {
      setExchange(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void window.api.session.exchange(cwd, selected).then((ex) => {
      if (cancelled) return
      setExchange(ex)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selected, cwd])

  if (!found) {
    return (
      <div className="pane-placeholder">
        <div>对话导航</div>
        <div className="pane-placeholder-hint">
          没找到该项目的 Claude Code 会话
          <br />
          在此终端里跑过 claude 后再打开
        </div>
      </div>
    )
  }

  return (
    <div className="chat-view">
      <div className="chat-head">
        <MessageIcon size={13} />
        <span className="chat-title">对话导航</span>
        <span className="chat-count">{turns.length} 条消息</span>
        <span className="pane-spacer" />
        <button className="icon-btn" title="刷新" onClick={() => void refresh()}>
          <RefreshIcon size={13} />
        </button>
      </div>
      <div className="chat-body">
        <div className="chat-list">
          {turns.length === 0 && <div className="git-empty">暂无消息</div>}
          {turns.map((t, i) => (
            <div
              key={t.uuid}
              className={`chat-item${selected === t.uuid ? ' active' : ''}`}
              onClick={() => setSelected(t.uuid)}
            >
              <div className="chat-item-top">
                <span className="chat-item-idx">#{i + 1}</span>
                <span className="chat-item-time">{fmtTime(t.at)}</span>
              </div>
              <div className="chat-item-preview">{t.preview}</div>
            </div>
          ))}
        </div>
        <div className="chat-detail">
          {!selected ? (
            <div className="git-diff-hint">在左侧选择一条你发的消息，回看这段对话</div>
          ) : loading ? (
            <div className="git-diff-hint">加载中…</div>
          ) : exchange ? (
            <div className="chat-thread">
              <div className="chat-msg user">
                <div className="chat-msg-role">你 · {fmtTime(exchange.at)}</div>
                <div className="chat-msg-body">{exchange.userText}</div>
              </div>
              <div className="chat-msg assistant">
                <div className="chat-msg-role">Claude</div>
                <div className="chat-msg-body">
                  {exchange.assistantText || '（这一轮没有文字回答）'}
                </div>
              </div>
            </div>
          ) : (
            <div className="git-diff-hint">读取失败</div>
          )}
        </div>
      </div>
    </div>
  )
}
