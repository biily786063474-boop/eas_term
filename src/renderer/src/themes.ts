// 主题系统：CSS 侧用 data-theme 属性切换自定义属性，xterm 侧用这里的主题对象。
import type { ITheme } from '@xterm/xterm'

export type ThemeId = 'default' | 'pink'

export interface ThemeMeta {
  id: ThemeId
  label: string
  /** 切换器里的色卡 */
  swatch: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'default', label: '默认 · 蓝', swatch: '#a2b9e0' },
  { id: 'pink', label: '黑粉', swatch: '#f78bb0' }
]

const XTERM_BASE = {
  foreground: '#d8dae0',
  black: '#32344a',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#ad8ee6',
  cyan: '#449dab',
  white: '#9699a8',
  brightBlack: '#444b6a',
  brightRed: '#ff7a93',
  brightGreen: '#b9f27c',
  brightYellow: '#ff9e64',
  brightBlue: '#7da6ff',
  brightMagenta: '#bb9af7',
  brightCyan: '#0db9d7',
  brightWhite: '#acb0d0'
}

const XTERM_THEMES: Record<ThemeId, ITheme> = {
  default: {
    ...XTERM_BASE,
    background: 'rgba(14, 15, 20, 0.45)',
    cursor: '#a2b9e0',
    cursorAccent: '#16171c',
    selectionBackground: 'rgba(162, 185, 224, 0.32)'
  },
  pink: {
    ...XTERM_BASE,
    background: 'rgba(10, 8, 10, 0.5)',
    cursor: '#f78bb0',
    cursorAccent: '#0c0a0c',
    selectionBackground: 'rgba(247, 139, 176, 0.3)',
    magenta: '#f78bb0',
    brightMagenta: '#ff9ec4'
  }
}

export function xtermTheme(id: ThemeId): ITheme {
  return XTERM_THEMES[id] ?? XTERM_THEMES.default
}

// 沿用旧 key（应用曾名为 TermHub），改名会丢失用户已选主题
const STORAGE_KEY = 'termhub-theme'

export function loadTheme(): ThemeId {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'pink' || saved === 'default' ? saved : 'default'
}

export function applyTheme(id: ThemeId): void {
  localStorage.setItem(STORAGE_KEY, id)
  document.documentElement.dataset.theme = id
}
