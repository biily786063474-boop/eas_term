import type { LivePageState } from '../../../../shared/livePage'

export function pickLivePage(states: LivePageState[], activeLeafId: string | undefined, activeIsAgent: boolean): LivePageState | undefined {
  if (activeIsAgent) return states.find((state) => state.leafId === activeLeafId)
  return [...states].reverse().find((state) => state.url || state.loading)
}
