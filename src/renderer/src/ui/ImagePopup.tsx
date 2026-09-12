import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './imagePopup.css'

/** 挂到 body，避开画布节点 transform / overflow 的裁剪。 */
export function ImagePopup({ src, alt = '图片预览', onClose }: { src: string; alt?: string; onClose: () => void }): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current
    el?.showModal()
    return () => { el?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return createPortal(
    <dialog ref={dialog} className="image-popup" aria-label={alt || '图片预览'}
      onCancel={e => { e.preventDefault(); onClose() }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <button autoFocus className="image-popup-close" aria-label="关闭图片预览" onClick={onClose}>×</button>
      <img src={src} alt={alt} draggable={false} />
    </dialog>, document.body
  )
}
