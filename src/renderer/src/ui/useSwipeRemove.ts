// 左滑移除：列表行往左拉，露出底下的「移除」区，过阈值松手就删。
//
// 两种输入都认：
//   · 触控板双指横滑 —— Mac 上「左滑」本来就是这个手势，走原生 wheel（deltaX）
//   · 鼠标左键往左拖 —— 没有触控板的人唯一的路
// 后者不是所有地方都能开：画布抽屉的项目行，左键拖拽已经被「拖到画布建 Frame」
// 占着，而且方向也是往左，硬加会打架。那种地方只留 wheel + 右键。
import { useCallback, useEffect, useRef, useState } from 'react'

/** 划过这么远松手才算数。太短容易误删，太长手感像卡住 */
const THRESHOLD = 72
/** 最多能拉这么远。再拉没有新反馈，只会让人以为拖不动了 */
const MAX = 112
/** 触控板没有「手势结束」事件，靠这段静默判定松手 */
const WHEEL_IDLE = 140

export type SwipePhase = 'idle' | 'drag' | 'back' | 'gone'

export interface SwipeRemove<T extends HTMLElement> {
  ref: React.RefObject<T>
  /** 当前位移（≤ 0）。绑到 transform 上 */
  dx: number
  phase: SwipePhase
  /** 0–1，底下那层「移除」的显现程度 */
  progress: number
  /** 只在允许鼠标拖的地方绑 */
  onMouseDown: (e: React.MouseEvent) => void
}

export function useSwipeRemove<T extends HTMLElement>(
  onRemove: () => void,
  opts: { pointer?: boolean; disabled?: boolean } = {}
): SwipeRemove<T> {
  const ref = useRef<T>(null)
  const [dx, setDx] = useState(0)
  const [phase, setPhase] = useState<SwipePhase>('idle')
  // 回调放 ref 里：wheel 监听器只挂一次，不该因为父组件重渲染就重挂
  const removeRef = useRef(onRemove)
  removeRef.current = onRemove
  const dxRef = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // wheel 监听器只挂一次，里面读不到最新的 phase state —— 用 ref 兜住
  const phaseRef = useRef<SwipePhase>('idle')
  phaseRef.current = phase

  const settle = useCallback((): void => {
    if (Math.abs(dxRef.current) >= THRESHOLD) {
      // 够了 → 先滑出去再真删。直接删的话行「啪」地消失，
      // 用户来不及把「我刚才划了一下」和「它没了」连起来
      setPhase('gone')
      dxRef.current = 0
      setTimeout(() => removeRef.current(), 240)
    } else {
      setPhase('back') // 不够 → 弹回去
      dxRef.current = 0
      setDx(0)
    }
  }, [])

  // wheel 必须非被动才能 preventDefault（不拦的话横滑会去滚外层容器）
  useEffect(() => {
    const el = ref.current
    if (!el || opts.disabled) return
    const onWheel = (e: WheelEvent): void => {
      // 竖向为主的滚动不拦，那是在滚列表
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      e.preventDefault()
      if (phaseRef.current === 'gone') return
      phaseRef.current = 'drag'
      setPhase('drag')
      // 双指左滑 → deltaX 为正 → dx 往负走
      dxRef.current = Math.max(-MAX, Math.min(0, dxRef.current - e.deltaX))
      setDx(dxRef.current)
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(settle, WHEEL_IDLE)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [settle, opts.disabled])

  const onMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      if (!opts.pointer || opts.disabled || e.button !== 0) return
      const sx = e.clientX
      const sy = e.clientY
      let armed = false // 确认是「横向左拉」之前不接管，免得吃掉普通点击
      const onMove = (ev: MouseEvent): void => {
        const mx = ev.clientX - sx
        const my = ev.clientY - sy
        if (!armed) {
          if (Math.abs(mx) < 6 || Math.abs(mx) <= Math.abs(my)) return
          if (mx > 0) return // 往右不是移除手势
          armed = true
          setPhase('drag')
        }
        ev.preventDefault()
        dxRef.current = Math.max(-MAX, Math.min(0, mx))
        setDx(dxRef.current)
      }
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        if (armed) settle()
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [opts.pointer, opts.disabled, settle]
  )

  return {
    ref,
    dx: phase === 'gone' ? -MAX * 1.6 : dx,
    phase,
    progress: Math.min(1, Math.abs(dx) / THRESHOLD),
    onMouseDown
  }
}
