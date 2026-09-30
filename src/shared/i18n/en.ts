// English dictionary aggregate. The type forces every key in zh.ts to exist here.
import type { zh } from './zh.ts'
import { appEn } from './dict/app.en.ts'
import { chatEn } from './dict/chat.en.ts'
import { canvasEn } from './dict/canvas.en.ts'
import { settingsEn } from './dict/settings.en.ts'
import { islandEn } from './dict/island.en.ts'
import { statusEn } from './dict/status.en.ts'
import { dialogsEn } from './dict/dialogs.en.ts'
import { panelsEn } from './dict/panels.en.ts'
import { shellEn } from './dict/shell.en.ts'
import { webEn } from './dict/web.en.ts'
import { terminalEn } from './dict/terminal.en.ts'
import { viewerEn } from './dict/viewer.en.ts'
import { gitEn } from './dict/git.en.ts'
import { rolesEn } from './dict/roles.en.ts'
import { errPluginEn } from './dict/errPlugin.en.ts'
import { errCoreEn } from './dict/errCore.en.ts'
import { codegraphEn } from './dict/codegraph.en.ts'
import { ganttEn } from './dict/gantt.en.ts'
import { wikiUiEn } from './dict/wikiUi.en.ts'
import { boardEn } from './dict/board.en.ts'
import { teamUiEn } from './dict/teamUi.en.ts'
import { pluginShellEn } from './dict/pluginShell.en.ts'
import { miscEn } from './dict/misc.en.ts'
import { dictUiEn } from './dict/dictUi.en.ts'

export const en: Record<keyof typeof zh, string> = {
  ...appEn,
  ...chatEn,
  ...canvasEn,
  ...settingsEn,
  ...islandEn,
  ...statusEn,
  ...dialogsEn,
  ...panelsEn,
  ...shellEn,
  ...webEn,
  ...terminalEn,
  ...viewerEn,
  ...gitEn,
  ...rolesEn,
  ...errPluginEn,
  ...errCoreEn,
  ...codegraphEn,
  ...ganttEn,
  ...wikiUiEn,
  ...boardEn,
  ...teamUiEn,
  ...pluginShellEn,
  ...miscEn,
  ...dictUiEn
}
