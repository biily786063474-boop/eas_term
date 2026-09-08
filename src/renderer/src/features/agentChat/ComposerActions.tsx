import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { popupPosition } from './composerCandidates'
import { expandChips, type DictChip } from './chips'
import type { SlashPickerState } from './SlashPicker'

export function ComposerActions({ picker, text, chips, imagePrefix = '' }: { picker: SlashPickerState; text: string; chips: readonly DictChip[]; imagePrefix?: string }): JSX.Element {
  const [preview, setPreview] = useState(false)
  const previewAnchor = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<ReturnType<typeof popupPosition>>(null)
  useLayoutEffect(() => {
    if (!preview) { setPosition(null); return }
    let frame = 0, last = ''
    const update = (): void => {
      const anchor = previewAnchor.current
      const next = anchor ? popupPosition(anchor.getBoundingClientRect(), innerWidth, innerHeight) : null
      const key = JSON.stringify(next)
      if (key !== last) { last = key; setPosition(next) }
      frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [preview])
  const explicit = expandChips(text, chips, false).usedIds
  const body = expandChips(text, chips).text
  const payload = imagePrefix ? imagePrefix + (body ? ' ' + body : '') : body
  return <div className="ac-composer-extras">
    <div className="ac-composer-shortcuts">
      <button type="button" aria-label="引用上下文" onMouseDown={e => e.preventDefault()} onClick={() => picker.activate('@')}>@</button>
      <button type="button" aria-label="命令与技能" disabled={!!text.trim()} title={text.trim() ? '在空输入框中使用斜杠命令' : '命令与技能'} onMouseDown={e => e.preventDefault()} onClick={() => picker.activate('/')}>/</button>
      <span>{chips.length ? explicit.length ? `本次引用 ${explicit.length} 条辞典` : `未引用辞典时，将附带全部 ${chips.length} 条备选` : '选择上下文，继续输入'}</span>
      <button ref={previewAnchor} type="button" aria-expanded={preview} onClick={() => { picker.close(); setPreview(v => !v) }}>发送内容预览</button>
    </div>
    {preview && position && createPortal(<div className="ac-send-preview" style={position} role="region" aria-label="发送内容预览"><div className="ac-send-preview-head"><strong>发送内容预览</strong><button type="button" aria-label="关闭发送预览" onClick={() => setPreview(false)}>×</button></div><pre>{payload || '尚未输入内容'}</pre></div>, document.body)}
  </div>
}
