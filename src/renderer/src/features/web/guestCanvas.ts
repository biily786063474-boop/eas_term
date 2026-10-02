// <webview> 里网页的「画布底色」。不 import React / store，`node --test` 裸跑。
//
// 浏览器里，网页没给 html/body 设背景的地方显示的是浏览器的默认底色：普通页面白色，
// 声明了深色（CSS `color-scheme: dark` 或 `<meta name="color-scheme" content="dark">`）的页面深色。
// Electron 的 <webview> 不是这样 —— guest 的底是**透明**的，透出来的是 <webview> 元素自己的背景。
// 这个元素原来跟着 app 主题是深色，于是没设背景的那些区域（阿里云控制台的标题区、很多自己写的 HTML 报告）
// 在画布上全变成黑底，而设了白底的卡片照旧是白的（2026-10-02 用户截图）。
// Electron 没有给 guest 设底色的 API（guest webContents 上没有 setBackgroundColor，实测），
// 所以由宿主读出页面实际用的配色方案，把元素背景涂成浏览器在那种方案下的默认底色。
// 只读不写：不往页面里插节点，也不改页面样式。

/** Chromium 的默认画布色：浅色白，深色 #121212 */
export const CANVAS_LIGHT = '#ffffff'
export const CANVAS_DARK = '#121212'

/** 在 guest 里执行的读取脚本：根元素的 color-scheme、meta 声明、系统是否深色。三项都是只读 */
export const PROBE_SCRIPT = `(() => ({
  css: getComputedStyle(document.documentElement).colorScheme || '',
  meta: (document.querySelector('meta[name="color-scheme" i]') || {}).content || '',
  prefersDark: matchMedia('(prefers-color-scheme: dark)').matches
}))()`

export interface SchemeProbe { css: string; meta: string; prefersDark: boolean }

/** 按 CSS Color Adjust 的规则算出页面实际用的方案：根元素的 color-scheme 优先，其次 meta；
 *  只声明 dark → 深色；同时声明 light 和 dark → 跟系统；都没声明（normal）→ 浅色 */
export function canvasColor(p: SchemeProbe | null | undefined): string {
  if (!p) return CANVAS_LIGHT
  const css = p.css.trim().toLowerCase()
  const decl = css && css !== 'normal' ? css : (p.meta || '').trim().toLowerCase()
  const words = decl.split(/[\s,]+/)
  const dark = words.includes('dark'), light = words.includes('light')
  if (dark && !light) return CANVAS_DARK
  if (dark && light) return p.prefersDark ? CANVAS_DARK : CANVAS_LIGHT
  return CANVAS_LIGHT
}
