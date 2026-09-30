import { useId, useState, type CSSProperties } from 'react'
import { effortIndex } from './effortPosition'
import { useT } from '../../i18n.ts'

/** 离散刻度映射能力目录；第 0 档始终表示不覆盖 CLI 默认值。 */
export function EffortSlider({ levels, value, onChange, defaultDescription }: {
  levels: { id: string; label: string }[]
  value: string
  defaultDescription?: string
  onChange: (value: string) => void
}): JSX.Element | null {
  const t = useT()
  const id = useId()
  const [drag, setDrag] = useState<number | null>(null)
  if (!levels.length) return null
  const index = value ? levels.findIndex(level => level.id === value) + 1 : 0
  const percent = drag ?? index / levels.length * 100
  const shownIndex = effortIndex(percent, levels.length)
  const commit = (percent: number): void => {
    const slot = effortIndex(percent, levels.length)
    setDrag(null); onChange(slot ? levels[slot - 1].id : '')
  }
  const selected = shownIndex > 0 ? levels[shownIndex - 1] : undefined
  const label = selected?.id ?? t('chat.effort.default')
  const description = selected ? t('chat.effort.appliesNext', { label: selected.label, id: selected.id }) : (defaultDescription ?? t('chat.effort.followDefault'))
  return <div className={`ac-effort-slider${selected ? ' pending' : ''}`} data-tip={t('chat.effort.tip', { desc: description })}>
    <span className="ac-effort-track" style={{ '--effort-progress': `${percent}%` } as CSSProperties}>
      <span className="ac-effort-ticks" aria-hidden="true">
        {['', ...levels.map(level => level.id)].map((level, i) => <i key={level} className={i <= shownIndex ? 'filled' : undefined} />)}
      </span>
      <input id={id} type="range" min={0} max={100} step={0.1} value={percent}
        aria-label={t('chat.effort.aria')} aria-valuetext={description}
        onChange={e => setDrag(Number(e.target.value))}
        onPointerUp={e => commit(Number(e.currentTarget.value))}
        onPointerCancel={() => setDrag(null)}
        onBlur={e => { if (drag !== null) commit(Number(e.currentTarget.value)) }}
        onKeyDown={e => {
          const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
          if (delta || e.key === 'Home' || e.key === 'End') { e.preventDefault(); commit(e.key === 'Home' ? 0 : e.key === 'End' ? 100 : (shownIndex + delta) / levels.length * 100) }
        }} />
    </span>
    <label htmlFor={id} className="ac-effort-value">{label}</label>
  </div>
}
