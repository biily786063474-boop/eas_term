// 设计模块（Step 1）：先把「渲染 + 导出到 <项目>/demo/」这条链跑通。
// 目前用一个内置 demo 动效状态（Step 2 会换成 Konva 设计画布产出的真实状态）。
// 复用移植自 taptv 的零依赖渲染/导出核心：renderFrame(单帧) / exportMotion(WebM)。
import { useEffect, useRef, useState } from 'react'
// 移植来的纯逻辑（.js，allowJs）——单帧渲染 + WebM 导出
import { renderFrame, preloadMedia } from './composer/animate/renderer'
import { exportMotion } from './composer/animate/exporter'
import './design.css'

const CW = 320
const CH = 200
const BG = '#0c0e13'
const DURATION = 4
const FPS = 30

// 内置 demo 动效：一个旋转呼吸的圆角矩形 + 淡入上移的标题（base 静态属性 + keyframes 动画）
const DEMO_LAYERS = [
  {
    id: 'card',
    type: 'rect',
    visible: true,
    inPoint: 0,
    outPoint: DURATION,
    base: {
      x: 50,
      y: 46,
      width: 220,
      height: 108,
      fill: '#7fa0d8',
      fillType: 'solid',
      cornerRadius: 20,
      opacity: 1,
      rotation: 0,
      scaleX: 1,
      scaleY: 1
    },
    keyframes: {
      rotation: [
        { t: 0, v: -4, easing: 'easeInOut' },
        { t: 2, v: 4, easing: 'easeInOut' },
        { t: 4, v: -4 }
      ],
      scaleX: [
        { t: 0, v: 0.96, easing: 'easeInOut' },
        { t: 2, v: 1.02, easing: 'easeInOut' },
        { t: 4, v: 0.96 }
      ]
    },
    presets: null
  },
  {
    id: 'title',
    type: 'text',
    visible: true,
    inPoint: 0,
    outPoint: DURATION,
    base: {
      x: 74,
      y: 84,
      text: 'Eas-Term',
      fontSize: 34,
      fontFamily: 'sans-serif',
      fill: '#0b0d12',
      opacity: 1,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 180,
      height: 44,
      textSizing: 'auto'
    },
    keyframes: {
      opacity: [
        { t: 0, v: 0, easing: 'easeOut' },
        { t: 1, v: 1 }
      ],
      y: [
        { t: 0, v: 104, easing: 'easeOut' },
        { t: 1, v: 84 }
      ]
    },
    presets: null
  }
]

export function DesignNode({ cwd }: { cwd: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState<null | string>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 实时预览：rAF 循环按 wall-clock 时间渲染 demo 动效（循环播放）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let start = performance.now()
    let alive = true
    void preloadMedia(DEMO_LAYERS)
    const loop = (): void => {
      if (!alive) return
      const t = ((performance.now() - start) / 1000) % DURATION
      renderFrame(ctx, DEMO_LAYERS, t, CW, CH, BG)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])

  const flash = (ok: boolean, text: string): void => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const write = async (blob: Blob, ext: string): Promise<void> => {
    const buf = await blob.arrayBuffer()
    const name = `design-${Date.now()}.${ext}`
    const r = await window.api.design.exportToDemo(cwd, name, buf)
    if (r.ok) flash(true, `已导出 → demo/${name}`)
    else flash(false, r.error ?? '导出失败')
  }

  const exportPng = async (): Promise<void> => {
    setBusy('PNG')
    try {
      const off = document.createElement('canvas')
      off.width = CW
      off.height = CH
      const ctx = off.getContext('2d')!
      await preloadMedia(DEMO_LAYERS)
      renderFrame(ctx, DEMO_LAYERS, 0, CW, CH, BG)
      const blob = await new Promise<Blob | null>((res) => off.toBlob(res, 'image/png'))
      if (blob) await write(blob, 'png')
    } catch (e) {
      flash(false, e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const exportWebm = async (): Promise<void> => {
    setBusy('WebM')
    try {
      const blob = await exportMotion({
        layers: DEMO_LAYERS,
        canvasWidth: CW,
        canvasHeight: CH,
        backgroundColor: BG,
        fps: FPS,
        duration: DURATION,
        onProgress: (p: number) => setBusy(`WebM ${Math.round(p * 100)}%`)
      })
      await write(blob, 'webm')
    } catch (e) {
      flash(false, e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="design-node">
      <div className="design-preview">
        <canvas ref={canvasRef} width={CW} height={CH} />
      </div>
      <div className="design-bar">
        <span className="design-hint">设计模块 · Step 1（导出链）</span>
        <span className="design-spacer" />
        <button className="design-btn" disabled={!!busy} onClick={() => void exportPng()}>
          {busy === 'PNG' ? '导出中…' : '导出 PNG'}
        </button>
        <button className="design-btn primary" disabled={!!busy} onClick={() => void exportWebm()}>
          {busy === 'WebM' ? '录制中…' : '导出动效 WebM'}
        </button>
      </div>
      {msg && <div className={`design-msg${msg.ok ? ' ok' : ' err'}`}>{msg.text}</div>}
    </div>
  )
}
