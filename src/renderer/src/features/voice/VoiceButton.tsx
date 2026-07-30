// 终端右下角的语音输入按钮（替代原「↓ 最新」）：点一下开始识别，说的话流式转文字写进终端。
// 录音中在按钮上方浮出灰色 interim（易变预览）；停手时把 SenseVoice 定稿写进 PTY（如同打字）。
// 首次使用：若模型未下载，点麦克风会先下载模型（~305MB，显进度），下完自动开始录音。

import { useEffect, useRef, useState } from 'react'
import { MicIcon } from '../../ui/Icons'
import { VoiceCapture } from './voiceCapture'
import './voice.css'

const TOTAL_MB = 305 // 两个模型合计约 305MB（进度显示参考值）

export function VoiceButton({
  ptyId,
  scale = 1
}: {
  ptyId: string
  /** 画布终端的落定缩放比：按它整体缩放，跟终端内容（字号缩放）保持相对静止 */
  scale?: number
}): JSX.Element {
  const [rec, setRec] = useState(false)
  const [interim, setInterim] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [dlMb, setDlMb] = useState<number | null>(null) // 下载中的已收 MB（null=非下载态）
  const capRef = useRef<VoiceCapture | null>(null)

  // 录音时：partial 显灰色预览；final = 主进程检测到「停顿 ~1s」后就地出的定稿 → 直接落进输入框。
  // 用户不用点麦克风，也看不到任何处理态（识别发生在他停下来的那段静音里），可以接着说下一句。
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

  // 用户按回车「发送」→ 自动收麦，避免发出去之后麦克风还在偷偷录着
  const stopRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') void stopRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rec])

  // 卸载确保停掉采麦
  useEffect(
    () => () => {
      capRef.current?.stop()
      if (capRef.current) void window.api.stt.stop()
    },
    []
  )

  const flash = (m: string): void => {
    setErr(m)
    setTimeout(() => setErr(null), 3500)
  }

  // 首次使用下载模型（带进度），下完自动开始录音
  const download = async (): Promise<void> => {
    setDlMb(0)
    const off = window.api.stt.onDownloadProgress((p) => {
      if (p.phase === 'downloading') setDlMb((p.received ?? 0) / 1048576)
      else if (p.phase === 'error') flash(p.error ?? '模型下载失败')
    })
    const r = await window.api.stt.downloadModels()
    off()
    setDlMb(null)
    if (r.ok) void start()
    else flash(r.error ?? '模型下载失败')
  }

  const start = async (): Promise<void> => {
    setErr(null)
    const r = await window.api.stt.start()
    if (!r.ok) {
      if (r.needDownload) {
        void download()
        return
      }
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
      // 先 stop 再丢引用。VoiceCapture.start() 里 getUserMedia 已经成功、
      // 后面某步才抛的情况下，麦克风是开着的；直接置 null 就再没人能关它了
      capRef.current?.stop()
      capRef.current = null
    }
  }

  // writeTail=false：因「发送」而收麦时丢弃残句——消息都发出去了，残字再落进去只会污染下一条输入
  const stop = async (writeTail = true): Promise<void> => {
    capRef.current?.stop()
    capRef.current = null
    setRec(false)
    setInterim('')
    const { text } = await window.api.stt.stop() // SenseVoice 定稿
    if (writeTail && text) window.api.pty.write(ptyId, text)
  }
  stopRef.current = () => stop(false) // 回车发送时收麦：只停，不补残句

  const downloading = dlMb !== null
  const onClick = (): void => {
    if (downloading) return
    if (rec) void stop()
    else void start()
  }

  return (
    <div
      className="voice-ctl"
      // 以右下角为锚点整体缩放：位置与大小都跟随终端内容比例，缩放时不再「漂移/失配」
      style={scale === 1 ? undefined : { transform: `scale(${scale})`, transformOrigin: '100% 100%' }}
    >
      {downloading && (
        <div className="voice-interim">
          首次使用 · 下载语音模型 {dlMb!.toFixed(0)} / ≈{TOTAL_MB} MB
        </div>
      )}
      {!downloading && rec && interim && <div className="voice-interim">{interim}</div>}
      {err && <div className="voice-err">{err}</div>}
      <button
        className={`voice-btn${rec ? ' rec' : ''}${downloading ? ' dl' : ''}`}
        data-tip={downloading ? '正在下载语音模型…' : rec ? '停止语音输入' : '语音输入'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClick}
      >
        <MicIcon size={15} />
      </button>
    </div>
  )
}
