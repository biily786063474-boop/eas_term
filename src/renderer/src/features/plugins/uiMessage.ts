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
