import pomodoro from '../../resources/plugin-market-details/pomodoro.json' with { type: 'json' }
import board from '../../resources/plugin-market-details/board.json' with { type: 'json' }
import excel from '../../resources/plugin-market-details/excel.json' with { type: 'json' }
import word from '../../resources/plugin-market-details/word.json' with { type: 'json' }
import powerpoint from '../../resources/plugin-market-details/powerpoint.json' with { type: 'json' }
import localFiles from '../../resources/plugin-market-details/local-files.json' with { type: 'json' }
import timeline from '../../resources/plugin-market-details/timeline.json' with { type: 'json' }
import jev from '../../resources/plugin-market-details/jev.json' with { type: 'json' }
import { parsePluginDetail, type PluginDetail } from './pluginDetail.ts'

const reviewed = [pomodoro, board, excel, word, powerpoint, localFiles, timeline, jev]
/** Published metadata takes priority; reviewed bundled copy only matches exact package bytes. */
export function resolvePluginDetail(entry: { name: string; version: string; sha256: string; detail?: PluginDetail }): PluginDetail | undefined {
  if (entry.detail) return entry.detail
  const local = reviewed.find(item => item.name === entry.name && item.version === entry.version && item.sha256 === entry.sha256)
  return local ? parsePluginDetail(local.detail) : undefined
}
