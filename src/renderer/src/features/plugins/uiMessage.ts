// 面板 → 宿主 `ui/message`：把面板给的一段话挂成对话输入框上的 chip。
// **纯函数，不 import React / store** —— 取 composerAddChip、回响应都在 PluginPanel 里。
// 参数按 ext-apps 规范：{ role:'user', content:[{ type:'text', text }] }；
// `_meta.eas.label` 是 Eas-Term 扩展，chip 上显示的短名，别的宿主不认也不影响。
// 设计稿：docs/superpowers/specs/2026-09-28-opus-gallery-design.md §二
import type { DictChip } from '../agentChat/chips.ts'

/** 数据集最长提示词 22367 字，加模板和附加约束留足余量 */
export const UI_MESSAGE_MAX_CHARS = 60000
export const UI_MESSAGE_LABEL_MAX = 40
/** 没有可注入的输入框时回给面板的话。**不降级写终端**：几百字灌进 CLI 输入行会被当场提交，撤不回。 */
export const NO_COMPOSER_ERROR = '没有可注入的对话框，先点一下要注入的对话框'

export type UiMessageChip = { ok: true; chip: DictChip } | { ok: false; error: string }

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function uiMessageChip(params: unknown, panel: { id: string; title: string }): UiMessageChip {
  if (!params || typeof params !== 'object') return { ok: false, error: '参数不是对象' }
  const p = params as { role?: unknown; content?: unknown; _meta?: { eas?: { label?: unknown } } }
  if (p.role !== 'user') return { ok: false, error: '只接受 role: user' }
  const blocks = Array.isArray(p.content) ? p.content : []
  const text = blocks
    .filter((b): b is { type: 'text'; text: string } => !!b && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text)
    .join('\n\n')
  if (!text.trim()) return { ok: false, error: '正文为空' }
  if (text.length > UI_MESSAGE_MAX_CHARS) return { ok: false, error: `正文超过 ${UI_MESSAGE_MAX_CHARS} 字` }
  const given = typeof p._meta?.eas?.label === 'string' ? p._meta.eas.label.trim() : ''
  const label = clip(given || text.trim().slice(0, 20), UI_MESSAGE_LABEL_MAX)
  return { ok: true, chip: { id: `plugin:${panel.id}:${fnv1a(text)}`, label: `${panel.title} · ${label}`, text } }
}

export const UI_MESSAGE_REMOTE_ERROR = '远程插件不能往对话框注入内容'
export const UI_MESSAGE_UNFOCUSED_ERROR = '请在面板里操作后再注入'
export const UI_MESSAGE_UNKNOWN_ERROR = '插件已移除，无法注入'

/**
 * `ui/message` 的闸门（最终审查 I-1）：chip 正文隐藏、会随下一条消息发给有 shell 的 agent，
 * 所以只放行**本地插件** + **用户此刻正在这个面板里操作**两者都成立的请求。
 * - remote：`PluginInfo.remote` 有值 = streamable-http 远程插件（主进程 pluginManifest 标注）；
 *   `null` = 列表里找不到这个插件（刚卸载等），一律拒。本地 stdio 插件本来就跑无沙箱 node，放行不新增能力；
 *   远程插件没有本地代码，放行就是凭空多出一条驾驶用户 agent 的路。
 * - focused：请求到达那一刻父文档 `document.activeElement === 本面板 iframe`（弹窗面板同一规则）。
 *   面板一加载就自己发、或用户在别处打字时后台发，都拦下。
 * 拒绝时回 JSON-RPC 错误并带一句人话，绝不静默成功。
 */
export function uiMessageAllowed(g: { remote: boolean | null; focused: boolean }): { ok: true } | { ok: false; error: string } {
  if (g.remote === null) return { ok: false, error: UI_MESSAGE_UNKNOWN_ERROR }
  if (g.remote) return { ok: false, error: UI_MESSAGE_REMOTE_ERROR }
  if (!g.focused) return { ok: false, error: UI_MESSAGE_UNFOCUSED_ERROR }
  return { ok: true }
}
