// 主进程的界面语言：偏好（prefs.lang）+ 系统语言 → 当前语言；变了就重建菜单、通知所有窗口。
// 渲染层和灵动岛首帧通过 additionalArguments 的 `--eas-lang=` 同步拿到，之后听 'i18n:changed'。
import { app, BrowserWindow } from 'electron'
import { getPrefs, onLangPref } from './prefs'
import { resolveLang, createT, type Lang, type T } from '../shared/i18n/index.ts'
import { setCurrentLang } from '../shared/i18n/current.ts'

export function currentLang(): Lang {
  return resolveLang(getPrefs().lang, app.getLocale())
}

/** 主进程里取文案：每次按当前语言现取，切换后下一次调用立即是新语言 */
export const t: T = (key, params) => createT(currentLang())(key, params)

/** 给 BrowserWindow 的 additionalArguments 用 */
export function langArg(): string {
  return `--eas-lang=${currentLang()}`
}

const listeners = new Set<() => void>()
/** 语言变了要重建的东西（应用菜单、Dock 菜单）在这里登记 */
export function onLangChanged(fn: () => void): void {
  listeners.add(fn)
}

export function initI18n(): void {
  // 纯逻辑模块（node --test 能跑的那些）通过 shared/i18n/current.ts 的 tm() 取文案，这里负责同步
  setCurrentLang(currentLang())
  onLangPref(() => {
    const lang = currentLang()
    setCurrentLang(lang)
    for (const fn of listeners) {
      try { fn() } catch { /* 一个重建失败不影响其余 */ }
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('i18n:changed', lang)
    }
  })
}
