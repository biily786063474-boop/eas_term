// 状态机与 store 之间唯一的那道门。四个视图都从这里拿数据，
// 谁都不许自己去 store 里捞那六个字段——那样又会长出第二套推导。
import { useMemo } from 'react'
import { useStore } from '../../store'
import { byProject, locate, sortRows, statusOf } from './machine'
import type { LocateCtx, Located, ProjectRow, RawSignals } from './machine'

/** 把 store 里那六个字段取成一份快照。
 *
 *  **逐字段订阅，不订阅整个 store。** 订阅整个 store 的话，任何无关变化
 *  （比如别的终端标题变了）都会让所有消费者重渲染一轮。 */
function useRaw(): RawSignals {
  const runningPtys = useStore((s) => s.runningPtys)
  const attentionPtys = useStore((s) => s.attentionPtys)
  const ptyApproval = useStore((s) => s.ptyApproval)
  const ptyTiming = useStore((s) => s.ptyTiming)
  return useMemo(
    () => ({ runningPtys, attentionPtys, ptyApproval, ptyTiming }),
    [runningPtys, attentionPtys, ptyApproval, ptyTiming]
  )
}

function useCtx(): LocateCtx {
  const tabs = useStore((s) => s.tabs)
  const frames = useStore((s) => s.canvas.frames)
  const projects = useStore((s) => s.projects)
  return useMemo(() => ({ tabs, frames, projects }), [tabs, frames, projects])
}

/** 所有有状态的项目，已排好序（approval > done > running）*/
export function useProjectRows(): ProjectRow[] {
  const raw = useRaw()
  const ctx = useCtx()
  return useMemo(() => {
    const ids = [...new Set([...raw.runningPtys, ...raw.attentionPtys])]
    return sortRows(byProject(ids, raw, ctx))
  }, [raw, ctx])
}

/** 已完成列表要显示的一条 */
export interface DoneRow extends Located {
  at: number
}

/** 只列 done 的终端，新的在前 */
export function useDoneRows(): DoneRow[] {
  const raw = useRaw()
  const ctx = useCtx()
  return useMemo(() => {
    const out: DoneRow[] = []
    for (const ptyId of raw.attentionPtys) {
      if (statusOf(ptyId, raw) !== 'done') continue
      const loc = locate(ptyId, ctx)
      if (!loc) continue
      out.push({ ...loc, at: raw.ptyTiming[ptyId]?.lastDoneAt ?? 0 })
    }
    return out.sort((a, b) => b.at - a.at)
  }, [raw, ctx])
}

/**
 * 跳到某个终端并清掉它的状态。
 *
 * **清除就发生在这里，只发生在这里。** 规格 §1.2 第四条：
 * 「被聚焦到眼前」= 发生了一次指向该终端的聚焦动作，
 * **「它在画布上可见」不算**——画布模式下 PaneLayer 把所有 leaf 都渲染着，
 * 拿可见性当判据的话 done 会在产生的同一帧被清掉，整个功能等于没有。
 */
export function focusTerminal(ptyId: string): void {
  const st = useStore.getState()
  const loc = locate(ptyId, { tabs: st.tabs, frames: st.canvas.frames, projects: st.projects })
  if (!loc) return
  if (loc.frameId && loc.nodeId) st.focusCanvasNode(loc.frameId, loc.nodeId)
  st.setActiveLeaf(loc.tabId, loc.leafId)
  st.clearAttention(ptyId)
}
