/**
 * ExportDialog — export design as PNG/JPG (Konva version)
 */
import React, { useState, useCallback } from 'react'
import { useUnifiedDesignStore } from './store'

const FORMATS = [
  { id: 'png', label: 'PNG', desc: '透明背景' },
  { id: 'jpeg', label: 'JPG', desc: '有损压缩' },
]

const SCALES = [1, 2, 3, 4]

export default function ExportDialog({ canvasRef, onExport, onClose }) {
  const [format, setFormat] = useState('png')
  const [scale, setScale] = useState(2)

  const handleExport = useCallback(() => {
    const stage = canvasRef?.current?.getStage?.()
    if (!stage) return

    const { canvasWidth, canvasHeight, backgroundColor } = useUnifiedDesignStore.getState()

    // Hide UI elements: transformer, mask outlines, grids, guides, pan background
    const tr = stage.findOne('Transformer')
    if (tr) tr.visible(false)
    const maskOutlines = stage.find('.__mask_outline') || []
    maskOutlines.forEach(n => n?.visible(false))
    const exportHide = stage.find('.__export_hide') || []
    exportHide.forEach(n => n?.visible(false))

    const oldPos = { x: stage.x(), y: stage.y() }
    const oldScale = { x: stage.scaleX(), y: stage.scaleY() }

    let dataUrl
    try {
      stage.position({ x: 0, y: 0 })
      stage.scale({ x: 1, y: 1 })
      stage.batchDraw()

      dataUrl = stage.toDataURL({
        x: 0, y: 0,
        width: canvasWidth,
        height: canvasHeight,
        pixelRatio: scale,
        mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        quality: format === 'jpeg' ? 0.92 : 1,
      })
    } catch (err) {
      console.error('[Export] toDataURL failed:', err)
      alert('导出失败：画布中可能包含跨域图片。请将外部图片替换为本地图片后重试。')
    } finally {
      stage.position(oldPos)
      stage.scale(oldScale)
      if (tr) tr.visible(true)
      maskOutlines.forEach(n => n.visible(true))
      exportHide.forEach(n => n.visible(true))
      stage.batchDraw()
    }

    if (!dataUrl) return
    // Convert data URL to blob without fetch (avoids CSP issues in Electron)
    try {
      const [header, b64] = dataUrl.split(',')
      if (!b64) { alert('导出失败：数据格式错误'); return }
      const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
      const bin = atob(b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      const blob = new Blob([arr], { type: mime })
      onExport?.(blob, format)
      onClose?.()
    } catch (err) {
      console.error('[Export] Blob conversion failed:', err)
      alert('导出失败：' + err.message)
    }
  }, [canvasRef, format, scale, onExport, onClose])

  return (
    <div className="uc-export-overlay" onClick={onClose}>
      <div className="uc-export" onClick={e => e.stopPropagation()}>
        <div className="uc-export__header">
          <span className="uc-export__title">导出设计</span>
          <button className="uc-export__close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="uc-export__body">
          <div className="uc-export__row">
            <span className="uc-export__label">格式</span>
            <div className="uc-export__chips">
              {FORMATS.map(f => (
                <button key={f.id}
                  className={`uc-export__chip${format === f.id ? ' uc-export__chip--active' : ''}`}
                  onClick={() => setFormat(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="uc-export__row">
            <span className="uc-export__label">倍率</span>
            <div className="uc-export__chips">
              {SCALES.map(s => (
                <button key={s}
                  className={`uc-export__chip${scale === s ? ' uc-export__chip--active' : ''}`}
                  onClick={() => setScale(s)}>
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="uc-export__footer">
          <button className="uc-export__btn" onClick={handleExport}>导出</button>
        </div>
      </div>
    </div>
  )
}
