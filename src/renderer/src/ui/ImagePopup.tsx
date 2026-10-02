import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ZoomableImage, type ZoomLabels } from './ZoomableImage'
import './imagePopup.css'

// alt / closeLabel / zoomLabels 由调用方传入已翻译的文案；下面的中文默认值只给单测用（单测的 vm 里 import 不了 i18n）。
const DEFAULT_ALT = '图片预览' // i18n-allow: 测试用默认值
const DEFAULT_CLOSE = '关闭图片预览' // i18n-allow: 测试用默认值

/**
 * 挂到 body，避开画布节点 transform / overflow 的裁剪。对话里所有「点图放大」都走这里（附件、Markdown 图片、
 * CLI 返回的图片、聊天导航），居中、适应窗口、可缩放拖动（见 ZoomableImage）。
 * src 为空时显示 status（返回图片的原图还在读 / 读失败）。
 * 弹窗里的键盘、按下、滚轮不往 React 祖先冒泡：它挂在画布节点下面，滚轮缩放不能顺带滚动 / 缩放画布。
 */
export function ImagePopup({ src, status, alt = DEFAULT_ALT, closeLabel = DEFAULT_CLOSE, zoomLabels, className, onImageError, onClose }: { src?: string; status?: string; alt?: string; closeLabel?: string; zoomLabels?: ZoomLabels; className?: string; onImageError?: () => void; onClose: () => void }): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current
    el?.showModal()
    return () => { el?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return createPortal(
    <dialog ref={dialog} className={className ? `image-popup ${className}` : 'image-popup'} aria-label={alt || DEFAULT_ALT}
      onCancel={e => { e.preventDefault(); onClose() }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <button autoFocus className="image-popup-close" aria-label={closeLabel} onClick={onClose}>×</button>
      {src ? <ZoomableImage src={src} alt={alt} labels={zoomLabels} onError={onImageError} onBackdrop={onClose} /> : <p className="image-popup-status" role="status">{status}</p>}
    </dialog>, document.body
  )
}
