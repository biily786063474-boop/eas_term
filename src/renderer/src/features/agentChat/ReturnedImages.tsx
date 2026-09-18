import { useEffect, useRef, useState, useId } from 'react'
import { useStore } from '../../store'
import { createPortal } from 'react-dom'
import { safeChatImages } from '../../../../shared/chatImages'

/** 原图来自经过校验的 data URL；既不联网也不按模型输出读取文件。 */
export function ReturnedImages({ images }: { images: unknown }): JSX.Element | null {
  const safe = safeChatImages(images)
  const [preview, setPreview] = useState<string | null>(null)
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const dialog = useRef<HTMLDialogElement>(null)
  const overlayId = useId()
  useEffect(() => {
    if (!preview) return
    if (!safe.length) { setPreview(null); return }
    const owner = 'chat-image-' + overlayId
    const previous = useStore.getState().fullscreenOverlay
    useStore.getState().setFullscreenOverlay(owner)
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
    return () => {
      if (useStore.getState().fullscreenOverlay === owner) useStore.getState().setFullscreenOverlay(previous)
    }
  }, [preview, overlayId, safe.length])
  if (!safe.length) return null
  return <>
    <div className="ac-returned-images" aria-label="AI 返回的图片">
      {safe.map((im, i) => failed.has(im.url)
        ? <span className="ac-returned-image-error" key={i}>图片无法解码</span>
        : <button type="button" key={i} aria-label={'放大返回图片 ' + (i + 1)} onClick={() => setPreview(im.url)}>
          <img src={im.url} alt={'返回图片 ' + (i + 1)} loading="lazy"
            onError={() => setFailed(old => new Set([...old, im.url]))} />
        </button>)}
    </div>
    {preview && createPortal(
      <dialog ref={dialog} className="ac-image-preview" aria-label="返回图片预览"
        onCancel={e => { e.preventDefault(); setPreview(null) }}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); setPreview(null) } }}
        onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
        onClick={e => { if (e.target === e.currentTarget) setPreview(null) }}>
        <button type="button" autoFocus aria-label="关闭图片预览" onClick={() => setPreview(null)}>关闭</button>
        <img src={preview} alt="返回图片原图" />
      </dialog>, document.body)}
  </>
}
