import { useEffect, useRef } from 'react'
import { startResizeDrag } from './resizeDrag.ts'

/** 组件内用：返回 begin(onMove, onEnd)；组件卸载时把还在进行的缩放拖动强制收尾（清 body 类）。 */
export function useResizeDrag(): typeof startResizeDrag {
  const stops = useRef(new Set<() => void>())
  useEffect(() => {
    const set = stops.current
    return () => [...set].forEach((s) => s())
  }, [])
  return (onMove, onEnd, env) => {
    const stop = startResizeDrag(
      onMove,
      () => {
        stops.current.delete(stop)
        onEnd()
      },
      env
    )
    stops.current.add(stop)
    return stop
  }
}
