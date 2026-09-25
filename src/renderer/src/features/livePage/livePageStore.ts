import { useSyncExternalStore } from 'react'
import type { LivePageState } from '../../../../shared/livePage'

let states: LivePageState[] = []
let generation = 0
const listeners = new Set<() => void>()
const notify = (): void => { for (const listener of listeners) listener() }

export function startLivePageUpdates(): () => void {
  const unsubscribe = window.api.livePage.onState((state) => {
    generation++
    states = !state.url && !state.visible && !state.popout && !state.loading
      ? states.filter((item) => item.owner !== state.owner)
      : states.some((item) => item.owner === state.owner)
        ? states.map((item) => item.owner === state.owner ? state : item)
        : [...states, state]
    notify()
  })
  const initialGeneration = generation
  void window.api.livePage.snapshot().then((snapshot) => {
    if (generation !== initialGeneration) return
    states = snapshot
    notify()
  }).catch(() => {})
  return unsubscribe
}

export function useLivePages(): LivePageState[] {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => states)
}
