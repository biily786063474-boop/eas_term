// 终端右下角的语音输入按钮（替代原「↓ 最新」）：点一下开始识别，说的话流式转文字写进终端。
// 录音中在按钮上方浮出灰色 interim（易变结果），到端点/停止时把定稿文字写进 PTY（如同打字）。

import { useEffect, useRef, useState } from 'react'
import { MicIcon } from '../../ui/Icons'
import { VoiceCapture } from './voiceCapture'
import './voice.css'

export function VoiceButton({ ptyId }: { ptyId: string }): JSX.Element {
  const [rec, setRec] = useState(false)
  const [interim, setInterim] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const capRef = useRef<VoiceCapture | null>(null)

  // 录音时订阅 partial/final：partial 显灰色浮层，final 立即写进终端（逐段）
  useEffect(() => {
    if (!rec) return
    const offP = window.api.stt.onPartial((t) => setInterim(t))
    const offF = window.api.stt.onFinal((t) => {
      if (t) window.api.pty.write(ptyId, t)
      setInterim('')
    })
    return () => {
      offP()
      offF()
    }
  }, [rec, ptyId])

  // 卸载确保停掉采麦（别让麦克风一直开着）
  useEffect(
    () => () => {
      capRef.current?.stop()
      if (capRef.current) void window.api.stt.stop()
    },
    []
  )

  const flash = (m: string): void => {
    setErr(m)
    setTimeout(() => setErr(null), 3000)
  }

  const start = async (): Promise<void> => {
    setErr(null)
    const r = await window.api.stt.start()
    if (!r.ok) {
      flash(r.error ?? '语音启动失败')
      return
    }
    try {
      capRef.current = new VoiceCapture()
      await capRef.current.start()
      setRec(true)
    } catch {
      flash('麦克风打不开')
      void window.api.stt.stop()
      capRef.current = null
    }
  }

  const stop = async (): Promise<void> => {
    capRef.current?.stop()
    capRef.current = null
    setRec(false)
    setInterim('')
    const { text } = await window.api.stt.stop()
    if (text) window.api.pty.write(ptyId, text) // 收尾残段
  }

  return (
    <div className="voice-ctl">
      {rec && interim && <div className="voice-interim">{interim}</div>}
      {err && <div className="voice-err">{err}</div>}
      <button
        className={`voice-btn${rec ? ' rec' : ''}`}
        data-tip={rec ? '停止语音输入' : '语音输入'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (rec ? void stop() : void start())}
      >
        <MicIcon size={15} />
      </button>
    </div>
  )
}
