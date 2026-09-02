// 主题系统：CSS 侧用 data-theme 属性切换自定义属性，xterm 侧用这里的主题对象。
import type { ITheme } from '@xterm/xterm'

/** **`light` 是这个软件的第一个亮色主题**（2026-09-02）。
 *  前两个（default / pink）都是暗色，所以 `base.css` 之外那 792 处硬编码颜色
 *  全都建立在「底是暗的」这个假设上 —— 那才是亮色模式的真实成本，
 *  要一处处迁到令牌上来。 */
/** 用户能选的三项。
 *
 *  **2026-09-02 改动**（用户：「取消黑粉配色主题，然后主题命名为暗色和亮色，
 *  然后还要有跟随系统」）：
 *  · 删掉 `pink`（黑粉）
 *  · `default` 改名 `dark`，界面上就叫「暗色」——「默认·蓝」这个名字在
 *    强调色改成中性灰之后已经不成立了
 *  · 新增 `system`：跟随操作系统，且**系统切换时当场跟着变**（不用重启）
 *
 *  `system` 是**用户的选择**，不是一个具体主题 —— 它最终解析成 dark 或 light。
 *  两者分开是必须的：只存解析结果的话，用户选了「跟随系统」，
 *  下次系统换了而我们记着的还是上次那个具体值，就不跟随了。 */
export type ThemeChoice = 'dark' | 'light' | 'system'
/** 真正落到 DOM 与 xterm 上的那个。`system` 不在其中 —— 它已经被解析掉了 */
export type ThemeId = 'dark' | 'light'

export interface ThemeMeta {
  id: ThemeChoice
  label: string
  /** 切换器里的色卡 */
  swatch: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'dark', label: '暗色', swatch: '#171717' },
  { id: 'light', label: '亮色', swatch: '#f7f7f8' },
  { id: 'system', label: '跟随系统', swatch: 'linear-gradient(135deg, #171717 50%, #f7f7f8 50%)' }
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
  dark: {
    ...XTERM_BASE,
    background: 'rgba(14, 15, 20, 0.45)',
    cursor: '#a2b9e0',
    cursorAccent: '#16171c',
    selectionBackground: 'rgba(162, 185, 224, 0.32)'
  },

}

export function xtermTheme(id: ThemeId): ITheme {
  return XTERM_THEMES[id] ?? XTERM_THEMES.dark
}

// 沿用旧 key（应用曾名为 TermHub），改名会丢失用户已选主题
const STORAGE_KEY = 'termhub-theme'

/** 系统现在是暗还是亮。 */
function systemIsDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    // 拿不到就按暗色算 —— 这个软件此前一直是暗的，猜错也是回到老样子
    return true
  }
}

/** 把「用户的选择」解析成「真正要应用的主题」。 */
export function resolveTheme(choice: ThemeChoice): ThemeId {
  if (choice === 'system') return systemIsDark() ? 'dark' : 'light'
  return choice
}

/** 读用户存下来的选择。
 *
 *  **要认得出老值**：`default`（旧的暗色）与 `pink`（已删的黑粉）都落到 `dark` ——
 *  不认的话老用户升级后会被重置，而且旧代码那句
 *  `saved === 'pink' || saved === 'default' ? saved : 'default'` 连 `light`
 *  都读不回来（存进去了，刷新就丢）。 */
export function loadTheme(): ThemeChoice {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'dark'
}

export function applyTheme(choice: ThemeChoice): void {
  localStorage.setItem(STORAGE_KEY, choice)
  document.documentElement.dataset.theme = resolveTheme(choice)
}

/** 订阅系统主题变化。**只有选了「跟随系统」才需要**。
 *
 *  不订阅的话，「跟随系统」就只在启动那一刻跟随一次 —— 用户在系统里切了亮暗，
 *  我们纹丝不动，那这个选项就是假的。返回退订函数。 */
export function watchSystemTheme(onChange: () => void): () => void {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  } catch {
    return () => undefined
  }
}
