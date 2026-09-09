import { VoiceRun } from './voiceRun'
import { voiceRouter } from './voiceRouter'
// 语音输入按钮：点一下开始识别，说的话流式转文字。
// 录音中浮出灰色 interim（易变预览）；停顿约 1s 就地出定稿。
// 首次使用：若模型未下载，点麦克风会先下载模型（~305MB，显进度），下完自动开始录音。
//
// 定稿去哪由 onText 决定：给了就交给调用方（现在是落进终端输入框，说完还能改再发），
// 没给就按老路直接写进 PTY。**别把这两条路同时接上**——会写两遍。

import { useEffect, useRef, useState } from 'react'
import { MicIcon } from '../../ui/Icons'
import { VoiceCapture } from './voiceCapture'
import { claimVoiceStopper, clearVoiceStopper } from './voiceControl'
import './voice.css'
import { track } from '../notify/track'

const TOTAL_MB = 306 // 两个模型合计约 305MB（进度显示参考值）

export function VoiceButton({
  ptyId,
  scale = 1,
  inline = false,
  onText,
  editorRef
}: {
  ptyId: string
  editorRef?: { readonly current: HTMLElement | null }
  /** 画布终端的落定缩放比：按它整体缩放，跟终端内容（字号缩放）保持相对静止 */
  scale?: number
  /** 嵌在输入框里（不再绝对定位到面板右下角，改为跟发送按钮并排） */
  inline?: boolean
  /** 收到定稿文字。给了就不再直接写 PTY */
  onText?: (text: string) => void
}): JSX.Element {
  const [rec, setRec] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [held, setHeld] = useState<{text:string; id:string}[]>([])
  const [mode, setMode] = useState<'standard' | 'strong' | 'basic'>(() => {
    const saved = localStorage.getItem('voice-filter-mode')
    return saved === 'strong' || saved === 'basic' ? saved : 'standard'
  })
  const [interim, setInterim] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [dlMb, setDlMb] = useState<number | null>(null) // 下载中的已收 MB（null=非下载态）
  const capRef = useRef<VoiceCapture | null>(null)
  const run = useRef(new VoiceRun()).current
  const stopping = useRef<Promise<void> | null>(null)
  const starting = useRef(false)
  const targetId = useRef(crypto.randomUUID()).current
  const aliveRef = useRef(true)
  const composingRef = useRef(false)
  const pendingTextRef = useRef<string[]>([])

  // 定稿的去处。放 ref 里让下面几个 effect 不必把 onText 加进依赖——
  // 调用方每次渲染都会新建这个闭包，进依赖会让录音监听反复重挂。
  const emitRef = useRef<(t: string) => void>(() => {})
  emitRef.current = (t: string): void => {
    if (onText) onText(t)
    else window.api.pty.write(ptyId, t)
  }

  const routeFinal = (text: string, target: string, segment?: string): void => {
    if (segment && voiceRouter.hasDelivered(segment)) return
    if (!voiceRouter.deliver(target, text, segment)) {
      const id = segment ?? crypto.randomUUID()
      setHeld(old => old.some(s => s.id === id) ? old : [...old,{text,id}])
    }
  }

  // 录音时：partial 显灰色预览；final = 主进程检测到「停顿 ~1s」后就地出的定稿。
  // 用户不用点麦克风，也看不到任何处理态（识别发生在他停下来的那段静音里），可以接着说下一句。
  useEffect(() => {
    if (!rec) return
    const offE = window.api.stt.onError((message) => {
      capRef.current?.stop(); capRef.current = null
      setRec(false); setInterim(''); setErr(message)
    })
    const offP = window.api.stt.onPartial((t) => setInterim(t))
    const offF = window.api.stt.onFinal((t, target, segment) => {
      if (target) { routeFinal(t, target, segment); setInterim(''); return }
      if (t) {
        if (composingRef.current) pendingTextRef.current.push(t)
        else emitRef.current(t)
      }
      setInterim('')
    })
    return () => {
      offE()
      offP()
      offF()
    }
  }, [rec])

  useEffect(() => {
    if (!editorRef) return
    let revision = 0
    let off = (): void => {}
    const register = (): void => {
      off()
      const id = `${targetId}:${revision}`
      if (editorRef.current) editorRef.current.dataset.voiceTarget = id
      off = voiceRouter.register(id, text => {
        const el = editorRef.current
        if (!el?.isConnected || el.hasAttribute('readonly') || el.hasAttribute('disabled') || el.getAttribute('contenteditable') === 'false' || el.getAttribute('type') === 'password') return false
        if (composingRef.current) pendingTextRef.current.push(text)
        else emitRef.current(text)
      })
    }
    register()
    const changed = (event: Event): void => {
      if (!editorRef.current?.contains(event.target as Node)) return
      if (pendingTextRef.current.length) {
        const texts = pendingTextRef.current.splice(0)
        setHeld(old => [...old,...texts.map(text => ({text,id:crypto.randomUUID()}))])
      }
      revision++; register(); focus()
    }
    document.addEventListener('input', changed)
    document.addEventListener('voice:document-edit', changed)
    const focus = (): void => {
      const el = editorRef.current, active = document.activeElement
      if (el && (el === active || el.contains(active))) voiceRouter.focus(el.dataset.voiceTarget ?? '')
    }
    const discard = (): void => { pendingTextRef.current = [] }
    document.addEventListener('voice:discard', discard)
    const begin = (e: CompositionEvent): void => { if (editorRef.current?.contains(e.target as Node)) composingRef.current = true }
    const end = (e: CompositionEvent): void => {
      if (!editorRef.current?.contains(e.target as Node)) return
      composingRef.current = false
      pendingTextRef.current.splice(0).forEach(t => emitRef.current(t))
    }
    document.addEventListener('focusin', focus)
    document.addEventListener('compositionstart', begin)
    document.addEventListener('compositionend', end)
    focus()
    return () => { document.removeEventListener('voice:document-edit', changed); document.removeEventListener('input', changed); document.removeEventListener('voice:discard', discard); if (editorRef.current?.dataset.voiceTarget?.startsWith(targetId)) delete editorRef.current.dataset.voiceTarget; off(); document.removeEventListener('focusin', focus); document.removeEventListener('compositionstart', begin); document.removeEventListener('compositionend', end) }
  }, [editorRef, targetId])

  // 「发送」→ 自动收麦，避免发出去之后麦克风还在偷偷录着。
  //
  // inline（嵌在输入框里）时把收麦函数登记出去，由发送方来调 —— 见 voiceControl.ts。
  // **不能再靠监听 Enter 键**：点发送按钮走的是 mousedown，根本没有 keydown，
  // 于是消息发出去了麦克风还录着，下一句话被接在后面。用户报的就是这个。
  const stopRef = useRef<(() => Promise<void>) | null>(null)
  const stopOwner = useRef(() => stopRef.current?.() ?? Promise.resolve()).current

  // 非 inline：这个按钮不属于任何输入框，用户是直接在终端里打字回车的，
  // 没有 send() 可以挂钩，只能听键盘。inline 时不装这个监听——那条路由上面的登记接管了。
  useEffect(() => {
    if (!rec || inline) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return
      void stopRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rec, inline])

  // 卸载确保停掉采麦
  useEffect(
    () => { aliveRef.current = true; return () => {
      aliveRef.current = false
      run.cancel(); clearVoiceStopper(stopOwner)
      pendingTextRef.current = []
      capRef.current?.stop()
      if (capRef.current) void window.api.stt.stop()
    } },
    []
  )

  const flash = (m: string): void => {
    setErr(m)
    setTimeout(() => setErr(null), 3500)
  }

  const start = async (): Promise<void> => {
    if (starting.current || stopping.current || capRef.current) return
    if (!claimVoiceStopper(stopOwner)) { flash('另一个输入框正在录音或收尾，请先停止'); return }
    starting.current = true
    const token = run.begin()
    // Claimed before permissions/model download; a second button cannot steal it.
    const valid = (): boolean => aliveRef.current && run.valid(token)
    if (editorRef) { editorRef.current?.focus(); voiceRouter.focus(editorRef.current?.dataset.voiceTarget ?? '') }
    track('voice'); setErr(null)
    let ownsMain = false
    try {
      let r = await window.api.stt.start(mode)
      ownsMain = r.ok
      if (!valid()) return
      if (!r.ok && r.needDownload) {
        setDlMb(0)
        const off = window.api.stt.onDownloadProgress(p => { if (valid() && p.phase === 'downloading') setDlMb((p.received ?? 0) / 1048576) })
        try {
          const downloaded = await window.api.stt.downloadModels()
          if (!valid()) return
          if (!downloaded.ok) throw new Error(downloaded.error ?? '模型下载失败')
        } finally { off(); if (aliveRef.current) setDlMb(null) }
        r = await window.api.stt.start(mode); ownsMain = r.ok
      }
      if (!valid()) return
      if (!r.ok) throw new Error(r.error ?? '语音启动失败；可在语音设置选择基础模式')
      const capture = new VoiceCapture(); capRef.current = capture
      await capture.start()
      if (!valid()) return
      setRec(true)
    } catch (error) {
      if (valid()) flash(String(error))
      capRef.current?.stop(); capRef.current = null
    } finally {
      starting.current = false
      if (!valid() || !capRef.current) {
        capRef.current?.stop(); capRef.current = null
        if (ownsMain) await window.api.stt.stop().catch(() => ({text:''}))
        clearVoiceStopper(stopOwner)
      }
    }
  }

  const stop = (writeTail = true): Promise<void> => {
    if (!writeTail) { run.cancel(); document.dispatchEvent(new Event('voice:discard')) }
    if (stopping.current) return stopping.current
    if (starting.current) return Promise.resolve() // start's finally owns cleanup after its await.
    if (!capRef.current && !rec) { clearVoiceStopper(stopOwner); return Promise.resolve() }
    const token = run.token
    capRef.current?.stop(); capRef.current = null
    setRec(false); setInterim('')
    stopping.current = (async () => {
      try {
        const {text, segments} = await window.api.stt.stop()
        if (!writeTail || !aliveRef.current || !run.valid(token)) return
        if (segments?.length) segments.forEach(s => routeFinal(s.text, s.targetId, s.segmentId))
        else if (text) emitRef.current(text)
      } catch (error) { if (aliveRef.current) flash(String(error)) }
      finally { stopping.current = null; clearVoiceStopper(stopOwner) }
    })()
    return stopping.current
  }
  stopRef.current = () => stop(false)

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
      {held.length > 0 && <div className="voice-settings" role="status">
        <strong>原输入已修改或关闭，语音暂未写入</strong>
        <small>{held.map(s => s.text).join('')}</small>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => {
          if (voiceRouter.deliver(voiceRouter.current, held.map(s => s.text).join(''))) setHeld([])
          else flash('请先点击一个可编辑的输入框')
        }}>插入到当前光标</button>
        <button type="button" onClick={() => setHeld([])}>丢弃候选</button>
      </div>}
      {settingsOpen && <div className="voice-settings" role="group" aria-label="语音过滤设置">
        <label>声音过滤<select aria-label="声音过滤模式" value={mode} disabled={rec} onChange={e => {
          const next = e.target.value as 'standard' | 'strong' | 'basic'
          setMode(next); localStorage.setItem('voice-filter-mode', next)
        }}>
          <option value="standard">标准 · 人声过滤</option>
          <option value="strong">强过滤 · 可能漏轻声</option>
          <option value="basic">基础 · 仅设备降噪</option>
        </select></label>
        <small>本地离线，不区分说话人。切换输入框后自动接着输入；旧句只写回原位置。</small>
        <button type="button" onClick={() => setSettingsOpen(false)}>收起</button>
      </div>}
      <button type="button" className="voice-settings-button" aria-label="语音过滤设置" aria-expanded={settingsOpen} onMouseDown={e => e.preventDefault()} onClick={() => setSettingsOpen(v => !v)}>⋯</button>
      <button
        className={`voice-btn${rec ? ' rec' : ''}${downloading ? ' dl' : ''}`}
        aria-label={rec ? '停止语音输入' : '语音输入'}
        data-tip={downloading ? '正在下载语音模型…' : rec ? '停止语音输入' : '语音输入'}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
        onClick={onClick}
      >
        <MicIcon size={15} />
      </button>
    </div>
  )
}
