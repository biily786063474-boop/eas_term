// English dictionary aggregate. The type forces every key in zh.ts to exist here.
import type { zh } from './zh.ts'
import { appEn } from './dict/app.en.ts'
import { chatEn } from './dict/chat.en.ts'
import { canvasEn } from './dict/canvas.en.ts'
import { settingsEn } from './dict/settings.en.ts'
import { islandEn } from './dict/island.en.ts'
import { statusEn } from './dict/status.en.ts'
import { dialogsEn } from './dict/dialogs.en.ts'

export const en: Record<keyof typeof zh, string> = {
  ...appEn,
  ...chatEn,
  ...canvasEn,
  ...settingsEn,
  ...islandEn,
  ...statusEn,
  ...dialogsEn
}
