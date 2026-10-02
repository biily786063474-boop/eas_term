import { useCallback, useEffect, useState } from 'react'
import { ImagePopup } from '../../ui/ImagePopup'
import { zoomLabelsFrom } from '../../ui/ZoomableImage'
import { t as tViewer, useT } from '../../i18n.ts'
import type { SessionTurn, SessionExchange } from '../../../../shared/types'
import { MessageIcon, RefreshIcon, ImageIcon } from '../../ui/Icons'
import './chat.css'

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return sameDay ? hm : tViewer('board.chatNav.dateTime', { m: d.getMonth() + 1, d: d.getDate(), hm })
}

// Claude Code 对话导航：读会话 transcript，左列你发的每条消息，点一条 → 右边看消息 + Claude 回答。
// 只读回看（终端拿不到 Claude Code 备用屏的实时滚动，故走它保存的 transcript 文件）。
export function ChatNavView({ cwd }: { cwd: string }): JSX.Element {
  const tr = useT()
  const [found, setFound] = useState(true)
  const [turns, setTurns] = useState<SessionTurn[]>([])
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)
  const [exchange, setExchange] = useState<SessionExchange | null>(null)
  const [loading, setLoading] = useState(false)
  // 点击图片放大查看（data: URI），Esc / 点击任意处关闭
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!zoomSrc) return
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setZoomSrc(null)
    }
    window.addEventListener('keydown', onEsc, { capture: true })
    return () => window.removeEventListener('keydown', onEsc, { capture: true })
  }, [zoomSrc])

  const refresh = useCallback(async (): Promise<void> => {
    if (!cwd) {
      setFound(false)
      return
    }
    const idx = await window.api.session.index(cwd)
    setFound(idx.found)
    setTurns(idx.turns)
    setSessionId(idx.sessionId)
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
    // 带上 sessionId 锁定文件：避免点击瞬间出现更新的会话文件导致 uuid 查错文件
    void window.api.session.exchange(cwd, selected, sessionId).then((ex) => {
      if (cancelled) return
      setExchange(ex)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selected, cwd, sessionId])

  if (!found) {
    return (
      <div className="pane-placeholder">
        <div>{tr('board.chatNav.title')}</div>
        <div className="pane-placeholder-hint">
          {tr('board.chatNav.noSession')}
          <br />
          {tr('board.chatNav.runFirst')}
        </div>
      </div>
    )
  }

  return (
    <div className="chat-view">
      <div className="chat-head">
        <MessageIcon size={13} />
        <span className="chat-title">{tr('board.chatNav.title')}</span>
        <span className="chat-count">{tr('board.chatNav.count', { n: turns.length })}</span>
        <span className="pane-spacer" />
        <button className="icon-btn" data-tip={tr('board.chatNav.refresh')} onClick={() => void refresh()}>
          <RefreshIcon size={13} />
        </button>
      </div>
      <div className="chat-body">
        <div className="chat-list">
          {turns.length === 0 && <div className="git-empty">{tr('board.chatNav.none')}</div>}
          {turns.map((t, i) => (
            <div
              key={t.uuid}
              className={`chat-item${selected === t.uuid ? ' active' : ''}`}
              onClick={() => setSelected(t.uuid)}
            >
              <div className="chat-item-top">
                <span className="chat-item-idx">#{i + 1}</span>
                <span className="chat-item-time">{fmtTime(t.at)}</span>
                {!!t.imageCount && (
                  <span className="chat-item-img" data-tip={tr('board.chatNav.images', { n: t.imageCount })}>
                    <ImageIcon size={11} />
                    {t.imageCount > 1 ? ` ×${t.imageCount}` : ''}
                  </span>
                )}
              </div>
              <div className="chat-item-preview">{t.preview}</div>
            </div>
          ))}
        </div>
        <div className="chat-detail">
          {!selected ? (
            <div className="git-diff-hint">{tr('board.chatNav.pick')}</div>
          ) : loading ? (
            <div className="git-diff-hint">{tr('board.chatNav.loading')}</div>
          ) : exchange ? (
            <div className="chat-thread">
              <div className="chat-msg user">
                <div className="chat-msg-role">{tr('board.chatNav.you', { time: fmtTime(exchange.at) })}</div>
                {!!exchange.images?.length && (
                  <div className="chat-msg-imgs">
                    {exchange.images.map((img, k) => {
                      const src = `data:${img.mediaType};base64,${img.data}`
                      return (
                        <img
                          key={k}
                          className="chat-msg-img"
                          src={src}
                          alt={tr('board.chatNav.imageN', { n: k + 1 })}
                          onClick={() => setZoomSrc(src)}
                        />
                      )
                    })}
                  </div>
                )}
                {exchange.userText && <div className="chat-msg-body">{exchange.userText}</div>}
              </div>
              <div className="chat-msg assistant">
                <div className="chat-msg-role">Claude</div>
                <div className="chat-msg-body">
                  {exchange.assistantText || tr('board.chatNav.noText')}
                </div>
              </div>
            </div>
          ) : (
            <div className="git-diff-hint">{tr('board.chatNav.readFail')}</div>
          )}
        </div>
      </div>
      {zoomSrc && <ImagePopup src={zoomSrc} alt={tViewer('viewer.imagePreview')} closeLabel={tViewer('viewer.closeImagePreview')} zoomLabels={zoomLabelsFrom(tViewer)} onClose={() => setZoomSrc(null)} />}
    </div>
  )
}
