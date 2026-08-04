// 语音输入按钮：点一下开始识别，说的话流式转文字。
// 录音中浮出灰色 interim（易变预览）；停顿约 1s 就地出定稿。
// 首次使用：若模型未下载，点麦克风会先下载模型（~305MB，显进度），下完自动开始录音。
//
// 定稿去哪由 onText 决定：给了就交给调用方（现在是落进终端输入框，说完还能改再发），
// 没给就按老路直接写进 PTY。**别把这两条路同时接上**——会写两遍。

import { useEffect, useRef, useState } from 'react'
import { MicIcon } from '../../ui/Icons'
import { VoiceCapture } from './voiceCapture'
import './voice.css'
import { track } from '../notify/track'

const TOTAL_MB = 305 // 两个模型合计约 305MB（进度显示参考值）

export function VoiceButton({
  ptyId,
  scale = 1,
  inline = false,
  onText
}: {
  ptyId: string
  /** 画布终端的落定缩放比：按它整体缩放，跟终端内容（字号缩放）保持相对静止 */
  scale?: number
  /** 嵌在输入框里（不再绝对定位到面板右下角，改为跟发送按钮并排） */
  inline?: boolean
  /** 收到定稿文字。给了就不再直接写 PTY */
  onText?: (text: string) => void
}): JSX.Element {
  const [rec, setRec] = useState(false)
  const [interim, setInterim] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [dlMb, setDlMb] = useState<number | null>(null) // 下载中的已收 MB（null=非下载态）
  const capRef = useRef<VoiceCapture | null>(null)

  // 定稿的去处。放 ref 里让下面几个 effect 不必把 onText 加进依赖——
  // 调用方每次渲染都会新建这个闭包，进依赖会让录音监听反复重挂。
  const emitRef = useRef<(t: string) => void>(() => {})
  emitRef.current = (t: string): void => {
    if (onText) onText(t)
    else window.api.pty.write(ptyId, t)
  }

  // 录音时：partial 显灰色预览；final = 主进程检测到「停顿 ~1s」后就地出的定稿。
  // 用户不用点麦克风，也看不到任何处理态（识别发生在他停下来的那段静音里），可以接着说下一句。
  useEffect(() => {
    if (!rec) return
    const offP = window.api.stt.onPartial((t) => setInterim(t))
    const offF = window.api.stt.onFinal((t) => {
      if (t) emitRef.current(t)
      setInterim('')
    })
    return () => {
      offP()
      offF()
    }
  }, [rec])

  // 「发送」→ 自动收麦，避免发出去之后麦克风还在偷偷录着。
  // inline 时发送键是 ⌘↵：裸回车在输入框里是换行，收麦会让人说到一半被打断。
  const stopRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return
      if (inline && !(e.metaKey || e.ctrlKey)) return
      void stopRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rec, inline])

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
    track('voice')
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
    if (writeTail && text) emitRef.current(text)
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
      className={`voice-ctl${inline ? ' inline' : ''}`}
      // 以右下角为锚点整体缩放：位置与大小都跟随终端内容比例，缩放时不再「漂移/失配」。
      // inline 时不缩放：它此刻是输入框的一部分，得跟旁边的发送按钮一样大。
      style={
        inline || scale === 1
          ? undefined
          : { transform: `scale(${scale})`, transformOrigin: '100% 100%' }
      }
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
