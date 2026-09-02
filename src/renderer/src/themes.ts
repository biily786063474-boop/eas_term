// 主题系统：CSS 侧用 data-theme 属性切换自定义属性，xterm 侧用这里的主题对象。
import type { ITheme } from '@xterm/xterm'

/** **`light` 是这个软件的第一个亮色主题**（2026-09-02）。
 *  前两个（default / pink）都是暗色，所以 `base.css` 之外那 792 处硬编码颜色
 *  全都建立在「底是暗的」这个假设上 —— 那才是亮色模式的真实成本，
 *  要一处处迁到令牌上来。 */
export type ThemeId = 'default' | 'pink' | 'light'

export interface ThemeMeta {
  id: ThemeId
  label: string
  /** 切换器里的色卡 */
  swatch: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'default', label: '默认 · 蓝', swatch: '#a2b9e0' },
  { id: 'pink', label: '黑粉', swatch: '#f78bb0' },
  { id: 'light', label: '亮色', swatch: '#f7f7f8' }
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

/** 亮色终端。**不能拿暗色那套前景色直接放白底上** ——
 *  `#d8dae0` 在白底上对比度不到 1.3:1，等于没有字。整套换成深色前景，
 *  ANSI 八色也换成在白底上读得出的那一档（暗色版是为黑底调的，饱和度偏高）。 */
const XTERM_LIGHT = {
  foreground: '#24292f',
  black: '#24292f',
  red: '#cf222e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#7d4e00',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#1b7c83',
  brightWhite: '#24292f'
}

const XTERM_THEMES: Record<ThemeId, ITheme> = {
  light: {
    ...XTERM_LIGHT,
    // **0.92 而不是 0.45**：半透明白压在暗色容器上会调出一片中灰
    // （用户 2026-09-02：「灰色再浅一点」）。终端是大面积阅读区，
    // 底色发灰会把整块界面的明度拖下来。
    background: 'rgba(255, 255, 255, 0.92)',
    cursor: '#3b6bb5',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(59, 107, 181, 0.22)'
  },
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
