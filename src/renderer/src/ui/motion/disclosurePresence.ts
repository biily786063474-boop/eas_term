export interface DisclosurePresence { present: boolean; active: boolean }
export type DisclosureEvent = 'open' | 'entered' | 'close' | 'exited'

/** Keep content through its exit transition, but never let a stale exit remove reopened content. */
export function nextDisclosurePresence(state: DisclosurePresence, event: DisclosureEvent): DisclosurePresence {
  switch (event) {
    case 'open': return state.active ? state : { present: true, active: false }
    case 'entered': return state.present ? { present: true, active: true } : state
    case 'close': return state.present ? { present: true, active: false } : state
    case 'exited': return state.active ? state : { present: false, active: false }
  }
}
