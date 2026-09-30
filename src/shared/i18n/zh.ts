// 中文词典汇总。文案按区域拆在 dict/<区域>.zh.ts —— 多人 / 多代理并行迁移时各改各的，不在同一个文件上撞车。
// 加区域：新建 dict/<区域>.zh.ts + .en.ts，再在这里和 en.ts 各加一行。键名冲突会被 i18n.test.ts 拦下。
import { appZh } from './dict/app.zh.ts'
import { chatZh } from './dict/chat.zh.ts'
import { canvasZh } from './dict/canvas.zh.ts'
import { settingsZh } from './dict/settings.zh.ts'
import { islandZh } from './dict/island.zh.ts'
import { statusZh } from './dict/status.zh.ts'
import { dialogsZh } from './dict/dialogs.zh.ts'
import { panelsZh } from './dict/panels.zh.ts'
import { shellZh } from './dict/shell.zh.ts'
import { webZh } from './dict/web.zh.ts'
import { terminalZh } from './dict/terminal.zh.ts'
import { viewerZh } from './dict/viewer.zh.ts'
import { gitZh } from './dict/git.zh.ts'
import { rolesZh } from './dict/roles.zh.ts'
import { errPluginZh } from './dict/errPlugin.zh.ts'
import { errCoreZh } from './dict/errCore.zh.ts'
import { codegraphZh } from './dict/codegraph.zh.ts'
import { ganttZh } from './dict/gantt.zh.ts'
import { wikiUiZh } from './dict/wikiUi.zh.ts'
import { boardZh } from './dict/board.zh.ts'
import { teamUiZh } from './dict/teamUi.zh.ts'
import { pluginShellZh } from './dict/pluginShell.zh.ts'
import { miscZh } from './dict/misc.zh.ts'

export const zh = {
  ...appZh,
  ...chatZh,
  ...canvasZh,
  ...settingsZh,
  ...islandZh,
  ...statusZh,
  ...dialogsZh,
  ...panelsZh,
  ...shellZh,
  ...webZh,
  ...terminalZh,
  ...viewerZh,
  ...gitZh,
  ...rolesZh,
  ...errPluginZh,
  ...errCoreZh,
  ...codegraphZh,
  ...ganttZh,
  ...wikiUiZh,
  ...boardZh,
  ...teamUiZh,
  ...pluginShellZh,
  ...miscZh
} as const
