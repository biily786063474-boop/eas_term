// 「这次按键是不是某条快捷键」——**全项目只有这一个判断入口**。
//
// 为什么要收口：键的定义在注册表（shared/shortcuts.ts），用户还能改键（覆盖层在
// store.shortcutOverrides）。分散判断的话，改键只在其中几处生效，症状是
// 「设置里改了，有的地方听、有的地方不听」，而那种 bug 极难查。
import { SHORTCUTS, resolveShortcuts, matchesDef, type ShortcutDef } from '../../shared/shortcuts.ts'
import { useStore } from './store'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

// 合并结果按 overrides 的**引用**缓存：键盘事件很密（每次按键都要查表），
// 而 overrides 只在用户改键时换一个新对象。zustand 的 set 保证改动时引用会变。
let memoSrc: unknown = Symbol('never')
let memoDefs: ShortcutDef[] = SHORTCUTS

/** 当前实际生效的键位（注册表 ＋ 用户覆盖）。设置界面也用它渲染。 */
export function currentShortcuts(): ShortcutDef[] {
  const ov = useStore.getState().shortcutOverrides
  if (ov !== memoSrc) {
    memoSrc = ov
    memoDefs = resolveShortcuts(SHORTCUTS, ov)
  }
  return memoDefs
}

/** 这次按键命中 `id` 这条快捷键了吗。id 认不出来时一律返回 false（不抛） */
export function shortcutHit(e: KeyboardEvent, id: string): boolean {
  const def = currentShortcuts().find((d) => d.id === id)
  return !!def && matchesDef(e, def, IS_MAC)
}

export { IS_MAC }
