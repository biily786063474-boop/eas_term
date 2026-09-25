import type { BrowserWindow } from 'electron'

const tag = Symbol.for('eas-term.live-page-window')

export function markLivePageWindow(window: BrowserWindow): void {
  ;(window as unknown as Record<symbol, boolean>)[tag] = true
}

export function isLivePageWindow(window: BrowserWindow): boolean {
  return (window as unknown as Record<symbol, boolean>)[tag] === true
}
