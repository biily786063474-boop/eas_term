// 插件面板的两个宿主动作（2026-09-29，发布台插件 P1；用户同意「宿主加面板写剪贴板接口：纯文本、限长、需点击触发」）：
//   panel/clipboard.write —— 面板在沙箱 iframe 里拿不到剪贴板，一键复制标题 / 正文要宿主代写；
//   panel/reveal          —— 在访达里定位素材文件（上传要用户自己拖，插件只帮找到文件）。
// 这里只放纯判定（零依赖、node --test 裸测）；闸门在渲染层（PluginPanel：本地插件 + 焦点在面板 + 真实点击），
// 真正的写剪贴板 / showItemInFolder 在主进程（pluginHost，路径另过 guardPath）。
// ⚠️ 不给这两个动作开「批量」「定时」口子：每次都要用户点一下，这是它们安全的全部理由。

/** 剪贴板上限：64KB（UTF-8 字节）。一条帖子最长的平台（Reddit 正文 40000 字符）也放得下 */
export const PANEL_CLIPBOARD_MAX_BYTES = 64 * 1024

export type ActionCheck<T> = { ok: true; value: T } | { ok: false; error: string }

export function clipboardTextOf(params: unknown): ActionCheck<string> {
  const text = (params as { text?: unknown } | null)?.text
  if (typeof text !== 'string') return { ok: false, error: '只能复制纯文本' }
  if (!text) return { ok: false, error: '没有要复制的内容' }
  if (new TextEncoder().encode(text).length > PANEL_CLIPBOARD_MAX_BYTES) return { ok: false, error: '内容超过 64KB，不能一次复制' }
  return { ok: true, value: text }
}

export function revealPathOf(params: unknown): ActionCheck<string> {
  const p = (params as { path?: unknown } | null)?.path
  if (typeof p !== 'string' || !p) return { ok: false, error: '缺少文件路径' }
  if (p.length > 4096) return { ok: false, error: '路径过长' }
  if (!p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p)) return { ok: false, error: '只接受绝对路径' }
  return { ok: true, value: p }
}

export const HOST_ACTION_REMOTE_ERROR = '远程插件不能使用剪贴板和访达定位'
export const HOST_ACTION_GESTURE_ERROR = '需要在面板里点击按钮触发'

/** 渲染层闸门：本地插件 + 焦点在这个面板 iframe + 浏览器认定的真实点击（transient user activation） */
export function hostActionAllowed(s: { remote: boolean | null; focused: boolean; activated: boolean }): { ok: true } | { ok: false; error: string } {
  if (s.remote !== false) return { ok: false, error: HOST_ACTION_REMOTE_ERROR }
  if (!s.focused || !s.activated) return { ok: false, error: HOST_ACTION_GESTURE_ERROR }
  return { ok: true }
}
