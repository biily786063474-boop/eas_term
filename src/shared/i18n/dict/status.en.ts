// English strings for the status area. Type forces every key of status.zh.ts to exist.
import type { statusZh } from './status.zh.ts'

export const statusEn: Record<keyof typeof statusZh, string> = {
  'status.icon.approval': 'Awaiting approval',
  'status.icon.done': 'Done',
  'status.icon.running': 'Running',
  'status.machine.aiChat': 'AI Chat',
  'status.machine.terminal': 'Terminal',
  'status.machine.unassigned': 'Unassigned',
  'status.monitor.collapse': 'Collapse',
  'status.monitor.expandTip': '{n} tasks running, click to expand',
  'status.monitor.focusTip': '{project} · {term} — click to focus this terminal',
  'status.monitor.title': 'Running {n}',
}
