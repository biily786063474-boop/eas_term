import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './imagePopup.css'

// alt / closeLabel 由调用方传入已翻译的文案；下面的中文默认值只给单测用（单测的 vm 里 import 不了 i18n）。
const DEFAULT_ALT = '图片预览' // i18n-allow: 测试用默认值
const DEFAULT_CLOSE = '关闭图片预览' // i18n-allow: 测试用默认值

/** 挂到 body，避开画布节点 transform / overflow 的裁剪。 */
export function ImagePopup({ src, alt = DEFAULT_ALT, closeLabel = DEFAULT_CLOSE, onClose }: { src: string; alt?: string; closeLabel?: string; onClose: () => void }): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current
    el?.showModal()
    return () => { el?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return createPortal(
    <dialog ref={dialog} className="image-popup" aria-label={alt || DEFAULT_ALT}
      onCancel={e => { e.preventDefault(); onClose() }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <button autoFocus className="image-popup-close" aria-label={closeLabel} onClick={onClose}>×</button>
      <img src={src} alt={alt} draggable={false} />
    </dialog>, document.body
  )
}
