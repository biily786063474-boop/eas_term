import { useRef, useState } from 'react'
import { ComposerPopover } from './ComposerPopover'
import { expandChips, type DictChip } from './chips'
import type { SlashPickerState } from './SlashPicker'

export function ComposerActions({ picker, text, chips, imagePrefix = '' }: { picker: SlashPickerState; text: string; chips: readonly DictChip[]; imagePrefix?: string }): JSX.Element {
  const [preview, setPreview] = useState(false)
  const previewAnchor = useRef<HTMLButtonElement>(null)
  const explicit = expandChips(text, chips, false).usedIds
  const body = expandChips(text, chips).text
  const payload = imagePrefix ? imagePrefix + (body ? ' ' + body : '') : body
  return <div className="ac-composer-extras">
    <div className="ac-composer-shortcuts">
      <button type="button" aria-label="引用上下文" data-tip="@ 引用文件、辞典或上下文，也可直接键入 @" onMouseDown={e => e.preventDefault()} onClick={() => picker.activate('@')}>@</button>
      <button type="button" aria-label="命令与技能" disabled={!!text.trim()} title={text.trim() ? '在空输入框中使用斜杠命令' : '命令与技能'} onMouseDown={e => e.preventDefault()} onClick={() => picker.activate('/')}>/</button>
      <button ref={previewAnchor} type="button" aria-label="发送内容预览" data-tip="查看将发送的文字、图片路径和引用内容" aria-expanded={preview} onClick={() => { picker.close(); setPreview(v => !v) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>
    </div>
    <ComposerPopover open={preview} anchor={previewAnchor} onClose={() => setPreview(false)} title="发送内容预览">
      {chips.length > 0 && <p className="ac-preview-note">{explicit.length ? `本次引用 ${explicit.length} 条辞典` : `未引用辞典时，将附带全部 ${chips.length} 条备选`}</p>}
      <pre>{payload || '尚未输入内容'}</pre>
    </ComposerPopover>
  </div>
}
