import { useRef, useState } from 'react'
import { useT } from '../../i18n.ts'
import { ComposerPopover } from './ComposerPopover'
import { expandChips, type DictChip } from './chips'
import type { SlashPickerState } from './SlashPicker'

export function ComposerActions({ picker, text, chips, imagePrefix = '' }: { picker: SlashPickerState; text: string; chips: readonly DictChip[]; imagePrefix?: string }): JSX.Element {
  const t = useT()
  const [preview, setPreview] = useState(false)
  const previewAnchor = useRef<HTMLButtonElement>(null)
  const explicit = expandChips(text, chips, false).usedIds
  const body = expandChips(text, chips).text
  const payload = imagePrefix ? imagePrefix + (body ? ' ' + body : '') : body
  return <div className="ac-composer-extras">
    <div className="ac-composer-shortcuts">
      <button type="button" aria-label={t('chat.composer.mentionAria')} data-tip={t('chat.composer.mentionTip')} onMouseDown={e => e.preventDefault()} onClick={() => picker.activate('@')}>@</button>
      <button type="button" aria-label={t('chat.composer.slashAria')} disabled={!!text.trim()} title={text.trim() ? t('chat.composer.slashEmptyOnly') : t('chat.composer.slashAria')} onMouseDown={e => e.preventDefault()} onClick={() => picker.activate('/')}>/</button>
      <button ref={previewAnchor} type="button" aria-label={t('chat.composer.previewAria')} data-tip={t('chat.composer.previewTip')} aria-expanded={preview} onClick={() => { picker.close(); setPreview(v => !v) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>
    </div>
    <ComposerPopover open={preview} anchor={previewAnchor} onClose={() => setPreview(false)} title={t('chat.composer.previewAria')}>
      {chips.length > 0 && <p className="ac-preview-note">{explicit.length ? t('chat.composer.previewNoteExplicit', { n: explicit.length }) : t('chat.composer.previewNoteAll', { n: chips.length })}</p>}
      <pre>{payload || t('chat.composer.previewEmpty')}</pre>
    </ComposerPopover>
  </div>
}
