import { useCallback, useEffect, useRef } from 'react'
import { startCanvasDrag, startResizeDrag } from './resizeDrag.ts'

/** 组件卸载时把还在进行的拖动强制收尾（清 body 类、拆监听）。 */
function useStops(): Set<() => void> {
  const stops = useRef(new Set<() => void>())
  useEffect(() => {
    const set = stops.current
    return () => [...set].forEach((s) => s())
  }, [])
  return stops.current
}

/** 组件内用：返回 begin(onMove, onEnd)；组件卸载时把还在进行的缩放拖动强制收尾（清 body 类）。 */
export function useResizeDrag(): typeof startResizeDrag {
  const stops = useStops()
  return useCallback<typeof startResizeDrag>((onMove, onEnd, env) => {
    const stop = startResizeDrag(onMove, () => { stops.delete(stop); onEnd() }, env)
    stops.add(stop)
    return stop
  }, [stops])
}

/** 组件内用的通用画布拖拽（框选 / 拖节点 / 平移 / 画图形……）。返回的 begin 引用稳定。 */
export function useCanvasDrag(): typeof startCanvasDrag {
  const stops = useStops()
  return useCallback<typeof startCanvasDrag>((onMove, onEnd, opts) => {
    const stop = startCanvasDrag(onMove, (ev) => { stops.delete(stop); onEnd(ev) }, opts)
    stops.add(stop)
    return stop
  }, [stops])
}
