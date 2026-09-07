import { useId, type CSSProperties } from 'react'

/** 离散刻度映射能力目录；第 0 档始终表示不覆盖 CLI 默认值。 */
export function EffortSlider({ levels, value, onChange }: {
  levels: { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
}): JSX.Element | null {
  const id = useId()
  if (!levels.length) return null
  const index = value ? levels.findIndex(level => level.id === value) + 1 : 0
  const selected = index > 0 ? levels[index - 1] : undefined
  const label = selected?.id ?? '默认'
  const description = selected ? `${selected.label}（${selected.id}），下条消息起生效` : '跟随 CLI 默认强度'
  return <div className={`ac-effort-slider${selected ? ' pending' : ''}`} data-tip={`思考强度：${description}`}>
    <span className="ac-effort-track" style={{ '--effort-progress': `${index / levels.length * 100}%` } as CSSProperties}>
      <span className="ac-effort-ticks" aria-hidden="true">
        {['', ...levels.map(level => level.id)].map((level, i) => <i key={level} className={i <= index ? 'filled' : undefined} />)}
      </span>
      <input id={id} type="range" min={0} max={levels.length} step={1} value={index}
        aria-label="思考强度" aria-valuetext={description}
        onChange={e => onChange(Number(e.target.value) === 0 ? '' : levels[Number(e.target.value) - 1].id)} />
    </span>
    <label htmlFor={id} className="ac-effort-value">{label}</label>
  </div>
}
