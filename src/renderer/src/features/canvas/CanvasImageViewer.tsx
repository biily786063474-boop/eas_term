// 画布图片节点：把同文件夹下所有图片读进来，左右切换 + 宫格阵列查看 + 单图缩放。
// 图片经 easfile:// 直接由 <img> 加载（含 gif/webp 动图原生播放，且不受 50MB base64 限制）。
//
// 缩放（2026-09-16）：双击放大到点 / 再双击复位；放大后拖动平移；底部 +/−/复位 + 显示 %。
// 滚轮缩放**只在节点最大化（铺满）时生效** —— 那时 wheelPassthrough 把普通滚轮释放给内容，
// 这个 onWheel 才收得到；没最大化时滚轮被画布吃掉（缩放画布），我们收不到、也就不冲突。
// 缩放永远归画布这条约定因此原封不动，两处 canvas onWheel 一个字都不用改。

import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CanvasIcon, CloseIcon } from '../../ui/Icons'
import { easfileUrl, isImagePath } from './media'

const SCALE_MIN = 1
const SCALE_MAX = 8

export function CanvasImageViewer({ filePath, revision = 0 }: { filePath: string | null; revision?: number }): JSX.Element {
  const [images, setImages] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [grid, setGrid] = useState(false)

  // 缩放态：scale=1 是「铺满」基线；tx/ty 是放大后拖动的平移量（像素）
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // filePath 变化 → 读所属文件夹里的全部图片，定位当前张
  useEffect(() => {
    if (!filePath) {
      setImages([])
      return
    }
    const dir = filePath.slice(0, filePath.lastIndexOf('/'))
    let alive = true
    window.api.fs
      .readDir(dir)
      .then((entries) => {
        if (!alive) return
        const imgs = entries
          .filter((e) => !e.isDir && isImagePath(e.path))
          .map((e) => e.path)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        setImages(imgs.length ? imgs : [filePath])
        const i = imgs.indexOf(filePath)
        setIndex(i >= 0 ? i : 0)
      })
      .catch(() => {
        if (alive) setImages([filePath])
      })
    return () => {
      alive = false
    }
  }, [filePath])

  const reset = (): void => { setScale(1); setTx(0); setTy(0) }
  // 换图 / 进出宫格都回到铺满，别把上一张的缩放带过来
  useEffect(reset, [index, grid, filePath])

  if (!filePath) return <div className="pane-placeholder">无图片</div>
  const list = images.length ? images : [filePath]
  const safeIndex = Math.min(index, list.length - 1)
  const cur = list[safeIndex]
  const go = (d: number): void => setIndex((i) => (i + d + list.length) % list.length)

  // 以容器内某点 (cx,cy 相对容器中心) 为锚点缩放到 next，锚点在屏幕上不动
  const zoomTo = (next: number, cx = 0, cy = 0): void => {
    const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, next))
    if (s === 1) { reset(); return }
    setTx((t) => clampPan(cx - (cx - t) * (s / scale), s, 'x'))
    setTy((t) => clampPan(cy - (cy - t) * (s / scale), s, 'y'))
    setScale(s)
  }
  // 平移夹取：让缩放后的图片不至于整块拖出容器（留住中心一带）
  const clampPan = (v: number, s: number, axis: 'x' | 'y'): number => {
    const box = boxRef.current
    if (!box) return v
    const half = ((axis === 'x' ? box.clientWidth : box.clientHeight) * (s - 1)) / 2
    return Math.max(-half, Math.min(half, v))
  }
  const relCenter = (e: { clientX: number; clientY: number }): { cx: number; cy: number } => {
    const r = boxRef.current!.getBoundingClientRect()
    return { cx: e.clientX - r.left - r.width / 2, cy: e.clientY - r.top - r.height / 2 }
  }

  const onWheel = (e: React.WheelEvent): void => {
    // 只有最大化时才收得到（见文件头注）。收到就缩图，别再往上冒泡。
    e.stopPropagation()
    const { cx, cy } = relCenter(e)
    zoomTo(scale * Math.exp(-e.deltaY * 0.0015), cx, cy)
  }
  const onDblClick = (e: React.MouseEvent): void => {
    if (scale > 1) { reset(); return }
    const { cx, cy } = relCenter(e)
    zoomTo(2, cx, cy)
  }
  const onPointerDown = (e: React.PointerEvent): void => {
    if (scale <= 1) return // 铺满时不拦，交给节点/画布
    if ((e.target as HTMLElement).closest('button')) return // 点按钮不是拖图
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, tx, ty }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    e.stopPropagation()
    const d = drag.current
    setTx(clampPan(d.tx + (e.clientX - d.x), scale, 'x'))
    setTy(clampPan(d.ty + (e.clientY - d.y), scale, 'y'))
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (!drag.current) return
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已释放 */ }
  }

  if (grid) {
    return (
      <div className="civ-grid">
        <button className="civ-grid-close" data-tip="返回单图" onClick={() => setGrid(false)}>
          <CloseIcon size={13} />
        </button>
        <div className="civ-grid-scroll">
          {list.map((p, i) => (
            <button
              key={p}
              className={`civ-cell${i === safeIndex ? ' cur' : ''}`}
              data-tip={p.split('/').pop()}
              onClick={() => {
                setIndex(i)
                setGrid(false)
              }}
            >
              <img src={`${easfileUrl(p)}?artifact=${revision}`} loading="lazy" decoding="async" draggable={false} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  const zoomed = scale > 1
  return (
    <div
      className={`civ${zoomed ? ' zoomed' : ''}`}
      ref={boxRef}
      onWheel={onWheel}
      onDoubleClick={onDblClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img
        className="civ-img"
        src={`${easfileUrl(cur)}?artifact=${revision}`}
        draggable={false}
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
      />
      {list.length > 1 && !zoomed && (
        <>
          <button className="civ-nav left" data-tip="上一张" onClick={() => go(-1)}>
            <ChevronLeftIcon size={18} />
          </button>
          <button className="civ-nav right" data-tip="下一张" onClick={() => go(1)}>
            <ChevronRightIcon size={18} />
          </button>
        </>
      )}
      <div className="civ-bar">
        <button className="civ-btn" data-tip="宫格查看本文件夹图片" onClick={() => setGrid(true)}>
          <CanvasIcon size={13} />
        </button>
        <span className="civ-sep" />
        <button className="civ-btn" data-tip="缩小" onClick={() => zoomTo(scale / 1.4)}>−</button>
        <span className="civ-zoom" data-tip="双击复位" onClick={reset}>{Math.round(scale * 100)}%</span>
        <button className="civ-btn" data-tip="放大" onClick={() => zoomTo(scale * 1.4)}>＋</button>
        <span className="civ-sep" />
        <span className="civ-count">
          {safeIndex + 1} / {list.length}
        </span>
        <span className="civ-name">{cur.split('/').pop()}</span>
      </div>
    </div>
  )
}
