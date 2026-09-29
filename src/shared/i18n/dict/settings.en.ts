// English strings for the settings area. Type forces every key of settings.zh.ts to exist.
import type { settingsZh } from './settings.zh.ts'

export const settingsEn: Record<keyof typeof settingsZh, string> = {
  'settings.language.group': 'Language & Region',
  'settings.language': 'Interface language',
  'settings.language.hint': 'Takes effect immediately. The AI still replies in the language you write in.',
  'settings.language.system': 'Follow System',
  'settings.language.zh': '中文',
  'settings.language.en': 'English'
}
