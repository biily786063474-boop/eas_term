// 快捷键注册表：**这个 app 有哪些快捷键，以这里为准。**
//
// 为什么要有它：在此之前键是写死在各组件 keydown 回调里的，散在 34 个文件。
// 后果有两个 —— 一是没有任何地方能列出「有哪些键」，设置界面根本无从渲染；
// 二是冲突只能靠人脑记（`Mod+D` 在分屏是「右分屏」、在画布是「复制选中」，
// 这种同键不同义全靠读代码才能发现）。
//
// 放 shared 而不是 renderer：它是纯数据 + 纯函数，主进程以后要加菜单 accelerator
// 时要用同一份定义，两边各存一份迟早对不上。**这一层禁 import electron / fs / net。**
//
// ⚠️ 本文件目前只是**真相源**，还没有接管实际的按键分发 —— App.tsx 与 CanvasStage
// 里的 keydown 仍是各自写死的。改键行为时**两边都要改**，直到迁移完成。

/** 作用域。现有代码里那些 `if (viewMode !== 'split') return` 就是它，
 *  写进数据而不是散在各处的 if。 */
export type ShortcutScope = 'global' | 'split' | 'canvas' | 'board'

export interface ShortcutDef {
  /** 稳定 id —— 改键要拿它当存储 key，**定了就不要改**（改了等于用户的自定义丢了）*/
  id: string
  /** 设置界面显示的中文名 */
  label: string
  /** 设置界面的分组 */
  group: string
  scope: ShortcutScope
  /** 默认组合。格式见 parseKeys */
  keys: string
  /** 等价键。Mac 键盘上写着 delete 的那个发的是 Backspace，两个都得认 */
  alt?: string[]
  /** 补充说明，设置界面显示在标题下面 */
  note?: string
}

/** 组合键的解析结果 */
export interface ParsedKeys {
  mod: boolean
  shift: boolean
  alt: boolean
  /** KeyboardEvent.key 的值。单字母统一大写，特殊键用 'Delete' / 'Escape' / 'Space' 这类 */
  key: string
}

/**
 * 解析组合键串。格式：`[Mod+][Shift+][Alt+]<Key>`
 *
 * `Mod` 是跨平台修饰键 —— mac 上是 ⌘、其它平台是 Ctrl。**不要写死 Cmd 或 Ctrl**：
 * 现有代码里那句 `isMac ? !e.metaKey : !e.ctrlKey` 就是这个意思，这里把它数据化。
 */
export function parseKeys(keys: string): ParsedKeys {
  const parts = keys.split('+').map((p) => p.trim()).filter(Boolean)
  const out: ParsedKeys = { mod: false, shift: false, alt: false, key: '' }
  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === 'mod') out.mod = true
    else if (low === 'shift') out.shift = true
    else if (low === 'alt' || low === 'option') out.alt = true
    else out.key = p.length === 1 ? p.toUpperCase() : p
  }
  return out
}

/**
 * 事件是否命中某个组合键。
 *
 * **修饰键要全等比对，不能只判「有没有按 Mod」** —— 否则 `Mod+D` 会把 `Shift+Mod+D`
 * 一起吃掉（那正是「右分屏 / 下分屏」这对键的关系，只判 Mod 会让下分屏永远进不去）。
 */
export function matchesShortcut(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  keys: string,
  isMac: boolean
): boolean {
  const p = parseKeys(keys)
  const modDown = isMac ? e.metaKey : e.ctrlKey
  // 非 Mod 的那个修饰键不能被按着：mac 上按 Ctrl+T 不该触发 ⌘T
  const otherMod = isMac ? e.ctrlKey : e.metaKey
  if (p.mod !== modDown) return false
  if (otherMod) return false
  if (p.shift !== e.shiftKey) return false
  if (p.alt !== e.altKey) return false
  // 单字母统一大写再比，免得受 shift 或输入法影响；空格在事件里是 ' '
  const evKey = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const want = p.key === 'Space' ? ' ' : p.key
  return evKey === want
}

/** 命中某条定义（含它的等价键） */
export function matchesDef(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  def: ShortcutDef,
  isMac: boolean
): boolean {
  if (matchesShortcut(e, def.keys, isMac)) return true
  return (def.alt ?? []).some((k) => matchesShortcut(e, k, isMac))
}

/** 显示用：'Shift+Mod+D' → mac '⇧⌘D'、其它 'Ctrl+Shift+D' */
export function formatKeys(keys: string, isMac: boolean): string {
  const p = parseKeys(keys)
  const nice: Record<string, string> = {
    Delete: 'Delete',
    Backspace: isMac ? '⌫' : 'Backspace',
    Escape: 'Esc',
    Space: isMac ? '空格' : 'Space',
    ArrowUp: '↑',
    ArrowDown: '↓'
  }
  const k = nice[p.key] ?? p.key
  if (isMac) return `${p.alt ? '⌥' : ''}${p.shift ? '⇧' : ''}${p.mod ? '⌘' : ''}${k}`
  const segs: string[] = []
  if (p.mod) segs.push('Ctrl')
  if (p.shift) segs.push('Shift')
  if (p.alt) segs.push('Alt')
  segs.push(k)
  return segs.join('+')
}

/**
 * 同作用域内的重键。
 *
 * **按作用域分组比对，不是全局比** —— `Mod+D` 在分屏是「右分屏」、在画布是「复制选中」，
 * 这不是冲突而是刻意的复用；跨作用域一刀切会报一堆假冲突，人就不看了。
 */
export function findConflicts(list: ShortcutDef[]): { keys: string; scope: ShortcutScope; ids: string[] }[] {
  const seen = new Map<string, string[]>()
  for (const d of list) {
    for (const k of [d.keys, ...(d.alt ?? [])]) {
      const p = parseKeys(k)
      const norm = `${p.mod ? 'M' : ''}${p.shift ? 'S' : ''}${p.alt ? 'A' : ''}${p.key}`
      const bucket = `${d.scope}::${norm}`
      seen.set(bucket, [...(seen.get(bucket) ?? []), d.id])
    }
  }
  const out: { keys: string; scope: ShortcutScope; ids: string[] }[] = []
  for (const [bucket, ids] of seen) {
    if (ids.length < 2) continue
    const [scope, norm] = bucket.split('::')
    out.push({ keys: norm, scope: scope as ShortcutScope, ids: [...new Set(ids)] })
  }
  return out.filter((c) => c.ids.length > 1)
}

/**
 * 现有快捷键。**这一版只录「已经实现的」，一个都不多加** ——
 * 先让注册表与代码对得上，补新绑定是下一步的事。
 */
export const SHORTCUTS: ShortcutDef[] = [
  // ── 分屏视图 ────────────────────────────────────────────────
  // 这几条现在只在分屏模式下生效（App.tsx 开头 `if (viewMode !== 'split') return`）。
  // 画布是默认视图，所以默认情况下它们是敲不出来的 —— 已知问题，待定夺。
  {
    id: 'split.new-terminal',
    label: '新建终端',
    group: '窗口与标签',
    scope: 'split',
    keys: 'Mod+T'
  },
  {
    id: 'split.close-pane',
    label: '关闭当前面板',
    group: '窗口与标签',
    scope: 'split',
    keys: 'Mod+W',
    note: '关的是面板，不是整个窗口'
  },
  {
    id: 'split.split-right',
    label: '向右分屏',
    group: '窗口与标签',
    scope: 'split',
    keys: 'Mod+D'
  },
  {
    id: 'split.split-down',
    label: '向下分屏',
    group: '窗口与标签',
    scope: 'split',
    keys: 'Shift+Mod+D'
  },
  {
    id: 'split.switch-tab',
    label: '切到第 N 个标签',
    group: '窗口与标签',
    scope: 'split',
    keys: 'Mod+1',
    note: '⌘1–⌘9 依次切到当前项目的第 1–9 个标签'
  },

  // ── 画布 ────────────────────────────────────────────────────
  {
    id: 'canvas.delete',
    label: '删除选中',
    group: '画布',
    scope: 'canvas',
    keys: 'Delete',
    alt: ['Backspace'],
    note: 'Mac 键盘上写着 delete 的那个键发的是 Backspace，两个都认'
  },
  {
    id: 'canvas.duplicate',
    label: '复制选中',
    group: '画布',
    scope: 'canvas',
    keys: 'Mod+D',
    note: '与分屏的「向右分屏」同键不同义 —— 作用域隔开，不是冲突'
  },
  {
    id: 'canvas.focus-selection',
    label: '聚焦到选中内容',
    group: '画布',
    scope: 'canvas',
    keys: 'F',
    note: '缩放并居中到选中的节点；有输入焦点时让路'
  },
  {
    id: 'canvas.pan',
    label: '临时平移画布',
    group: '画布',
    scope: 'canvas',
    keys: 'Space',
    note: '按住不放'
  }
]
