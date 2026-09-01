// 主进程侧的偏好存储（userData/prefs.json）。
//
// 为什么不放渲染层的 localStorage：检查更新和使用统计都在**主进程启动时**就要
// 知道开关状态，而渲染层要等窗口加载完才能告诉主进程——那之前的事件全漏了。
// 所以这两个开关以主进程为准，渲染层通过 IPC 读写。
//
// 主题、提示音那些只影响界面的仍留在渲染层，不用搬过来。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

export interface Prefs {
  /** 启动后自动检查有没有新版本 */
  autoUpdateCheck: boolean
  /** 匿名使用统计（只有时长和功能计数，见 telemetry.ts 的白名单） */
  telemetry: boolean
  /** 快照后怎么处理标记。**未设置 = 每次都问** —— 所以是可选字段，不给默认值 */
  clearShapesAfterSnapshot?: 'keep' | 'clear'
  /** 插入文件选择器的「最近」是否只看文档文件 */
  recentDocsOnly: boolean
  /** 灵动岛被收成「摄像头左边一颗呼吸的圆点」。
   *  放主进程而不是渲染层：岛的窗口位置在主进程算，**开窗那一刻就得知道**
   *  该摆在屏幕中线还是刘海左侧 —— 等渲染层加载完再告诉主进程，
   *  中间那一帧会先在中间闪一下整条岛再跳过去。 */
  islandMini: boolean
  /** 要不要有灵动岛。**关掉之后那扇窗口根本不建** ——
   *  不是「建了但隐藏」，那样它照样占着一个 BrowserWindow 和一份渲染进程。 */
  island: boolean
  /** 用户改过的快捷键：`{ [快捷键 id]: 组合串 }`。**只存改过的那几条** ——
   *  全量存下来的话，以后改了默认值，用户那份还压着旧的，而他并不知道自己「改过」。
   *  id 与组合串的含义见 src/shared/shortcuts.ts。 */
  shortcutOverrides?: Record<string, string>
}

const DEFAULTS: Prefs = {
  autoUpdateCheck: true,
  telemetry: true,
  recentDocsOnly: false,
  islandMini: false,
  island: true
}

let cache: Prefs | null = null

const file = (): string => path.join(app.getPath('userData'), 'prefs.json')

export function getPrefs(): Prefs {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Prefs>
    // 逐字段兜底：文件里缺字段、或被人手改成别的类型，都退回默认值而不是让 undefined 到处跑
    cache = {
      autoUpdateCheck:
        typeof raw.autoUpdateCheck === 'boolean' ? raw.autoUpdateCheck : DEFAULTS.autoUpdateCheck,
      island: typeof raw.island === 'boolean' ? raw.island : DEFAULTS.island,
      telemetry: typeof raw.telemetry === 'boolean' ? raw.telemetry : DEFAULTS.telemetry,
      islandMini: typeof raw.islandMini === 'boolean' ? raw.islandMini : DEFAULTS.islandMini,
      clearShapesAfterSnapshot:
        raw.clearShapesAfterSnapshot === 'keep' || raw.clearShapesAfterSnapshot === 'clear'
          ? raw.clearShapesAfterSnapshot
          : undefined,
      recentDocsOnly:
        typeof raw.recentDocsOnly === 'boolean' ? raw.recentDocsOnly : DEFAULTS.recentDocsOnly,
      // 逐条挑：这文件用户和外部工具都能改，一条坏数据不该让整份改键失效。
      // 值限长是防呆 —— 组合串最长也就 'Alt+Shift+Mod+Backspace' 这个量级，
      // 塞进来一篇文章只会把设置界面撑坏。
      shortcutOverrides:
        raw.shortcutOverrides && typeof raw.shortcutOverrides === 'object' && !Array.isArray(raw.shortcutOverrides)
          ? Object.fromEntries(
              Object.entries(raw.shortcutOverrides as Record<string, unknown>).filter(
                ([k, v]) => typeof k === 'string' && k.length <= 64 && typeof v === 'string' && v.length <= 40
              ) as [string, string][]
            )
          : undefined
    }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Prefs {
  const next = { ...getPrefs(), [key]: value }
  cache = next
  try {
    fs.writeFileSync(file(), JSON.stringify(next, null, 2))
  } catch {
    // 写不进去也不该让界面卡住：这一轮的开关在内存里已经生效了
  }
  return next
}

/** 灵动岛开关变了 → 让 island.ts 立刻重算该不该有那扇窗口。
 *  **用回调不直接 import**：prefs 是最底层的模块，反过来依赖 island
 *  会绕成一个环（island.ts 顶上就 import 了 prefs）。 */
let onIslandPrefChanged: (() => void) | null = null
export function onIslandPref(fn: () => void): void {
  onIslandPrefChanged = fn
}

export function registerPrefsHandlers(): void {
  ipcMain.handle('prefs:get', () => getPrefs())
  ipcMain.handle('prefs:set', (_e, key: keyof Prefs, value: unknown) => {
    if (
      key === 'autoUpdateCheck' ||
      key === 'telemetry' ||
      key === 'recentDocsOnly' ||
      key === 'island'
    ) {
      const next = setPref(key, !!value)
      // 灵动岛的开关要**当场生效**：不通知的话，关掉之后那扇窗口还挂在
      // 屏幕顶上，直到下一次有事件触发 reconcile —— 用户会以为开关是坏的
      if (key === 'island') onIslandPrefChanged?.()
      return next
    }
    // 这一个的值是字符串或 undefined，不能走上面的 !!value —— 那会把 'keep' 压成 true
    if (key === 'clearShapesAfterSnapshot') {
      const v = value === 'keep' || value === 'clear' ? value : undefined
      return setPref(key, v)
    }
    return getPrefs()
  })
}
