// English strings for the app area. Type forces every key of app.zh.ts to exist.
import type { appZh } from './app.zh.ts'

export const appEn: Record<keyof typeof appZh, string> = {
  'menu.about': 'About Eas-Term',
  'menu.hide': 'Hide Eas-Term',
  'menu.hideOthers': 'Hide Others',
  'menu.unhide': 'Show All',
  'menu.quit': 'Quit Eas-Term',
  'menu.edit': 'Edit',
  'menu.undo': 'Undo',
  'menu.redo': 'Redo',
  'menu.cut': 'Cut',
  'menu.copy': 'Copy',
  'menu.paste': 'Paste',
  'menu.selectAll': 'Select All',
  'menu.view': 'View',
  'menu.reload': 'Reload',
  'menu.devTools': 'Developer Tools',
  'menu.fullscreen': 'Toggle Full Screen',
  'menu.window': 'Window',
  'menu.minimize': 'Minimize',
  'menu.zoom': 'Zoom',
  'dock.awaitingApproval': 'Awaiting approval',
  'dock.done': 'Done',
  'dock.bgRunning': 'Running in background',
  'dock.bgRunningTask': 'Running in background · {task}',
  'dock.runningFor': 'running {dur}',
  'dock.nothingRunning': 'Nothing running',
  'dock.showIsland': 'Show Island',
  'dock.openIslandLog': 'Open Island Error Log'
}
