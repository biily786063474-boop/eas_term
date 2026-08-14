// 三个状态 icon 的**唯一**实现。四个显示面都用它——
// 各画一份的话，改动效就得改四处，而漏掉的那处只会「看起来有点不一样」，很难被报上来。
import type { TermState } from './machine'
import './status.css'

interface Props {
  state: TermState
  size?: number
}

export function StatusIcon({ state, size = 14 }: Props): JSX.Element {
  if (state === 'running') {
    // 三个点轮番上跳。相位差写在 CSS 的 animation-delay 里
    return (
      <span className="st-icon st-running" role="img" style={{ width: size, height: size }} aria-label="正在运行">
        <i /><i /><i />
      </span>
    )
  }
  if (state === 'approval') {
    return (
      <span className="st-icon st-approval" role="img" style={{ width: size, height: size }} aria-label="等待批准">
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
          <circle cx="12" cy="12" r="9" strokeWidth="2" stroke="currentColor" />
          <path d="M12 7.5v5.5" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1.1" fill="currentColor" />
        </svg>
      </span>
    )
  }
  // done：圈 + 对勾，**对勾右端超出圆的边缘**
  return (
    <span className="st-icon st-done" role="img" style={{ width: size, height: size }} aria-label="已完成">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{ overflow: 'visible' }}>
        <circle cx="11" cy="12" r="8" strokeWidth="2" stroke="currentColor" />
        {/* 终点 x=23 > 圆的右缘 x=19：对勾右端**故意**探出圆外，
            这是规格点名的形态。防御性保留 overflow:visible：路径最大坐标（含描边端帽）约 23.83，
            仍在 viewBox 0–24 内，去掉这行现在不会裁；但对勾本来就贴着右边缘设计，
            以后调路径很容易越界，留着省得那时候再查半天。 */}
        <path d="M7 12.5l3.2 3.2L23 4.5" strokeWidth="2.2" stroke="currentColor"
              strokeLinecap="round" strokeLinejoin="round" className="st-check" />
      </svg>
    </span>
  )
}
