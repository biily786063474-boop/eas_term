// 画布图片节点：把同文件夹下所有图片读进来，左右切换 + 宫格阵列查看。
// 图片经 easfile:// 直接由 <img> 加载（含 gif/webp 动图原生播放，且不受 50MB base64 限制）。

import { useEffect, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CanvasIcon, CloseIcon } from '../../ui/Icons'
import { easfileUrl, isImagePath } from './media'

export function CanvasImageViewer({ filePath }: { filePath: string | null }): JSX.Element {
  const [images, setImages] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [grid, setGrid] = useState(false)

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

  if (!filePath) return <div className="pane-placeholder">无图片</div>
  const list = images.length ? images : [filePath]
  const safeIndex = Math.min(index, list.length - 1)
  const cur = list[safeIndex]
  const go = (d: number): void => setIndex((i) => (i + d + list.length) % list.length)

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
              <img src={easfileUrl(p)} loading="lazy" decoding="async" draggable={false} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="civ">
      <img className="civ-img" src={easfileUrl(cur)} draggable={false} />
      {list.length > 1 && (
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
        <span className="civ-count">
          {safeIndex + 1} / {list.length}
        </span>
        <span className="civ-name">{cur.split('/').pop()}</span>
      </div>
    </div>
  )
}
