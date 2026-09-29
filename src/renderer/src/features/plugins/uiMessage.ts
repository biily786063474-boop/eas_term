// 面板 → 宿主 `ui/message`：把面板给的一段话注入到面板所在 Frame 里的 AI 对话（挂 chip）或终端（粘贴不回车）。
// **纯函数，不 import React / store** —— 取 leaf / chipTargets、写 pty、弹选择菜单、回响应都在 PluginPanel 里。
// 参数按 ext-apps 规范：{ role:'user', content:[{ type:'text', text }] }；
// `_meta.eas.label` 是 Eas-Term 扩展，chip 上显示的短名，别的宿主不认也不影响。
// 设计稿：docs/superpowers/specs/2026-09-28-opus-gallery-design.md §二
import type { DictChip } from '../agentChat/chips.ts'

/** 数据集最长提示词 22367 字，加模板和附加约束留足余量 */
export const UI_MESSAGE_MAX_CHARS = 60000
export const UI_MESSAGE_LABEL_MAX = 40

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

// ── 注入目标：按面板所在 Frame 找（Task 7，替换「最后聚焦的全局对话框」）──
// 旧做法取全局 composerAddChip：要求用户先点一下某个对话框，而且点过别处的对话框后
// 会注入到另一个项目里去。现在只看**面板所在的这一个 Frame**：
// 0 个 → 报错；1 个 → 直接注入；多个 → PluginPanel 弹菜单让用户选。

export const NO_TARGET_ERROR = '这个 Frame 里没有 AI 对话或终端'
export const PICK_CANCELLED_ERROR = '已取消'
export const PICK_BUSY_ERROR = '请先完成上一次选择'
export const AGENT_NOT_READY_ERROR = '这个 AI 对话的输入框还没准备好，点开它后再试'
export const TERMINAL_EXITED_ERROR = '这个终端已经退出'

export type InjectTarget = { nodeId: string; leafId: string; kind: 'agent' | 'terminal'; name: string; ptyId?: string }

/**
 * 面板所在 Frame 里能注入的目标，按节点顺序。
 * - 只看传进来这个 Frame 自己的 `nodes`：子 Frame 是另一个 CanvasFrame（parentId 指向父），天然不含。
 * - 节点经 `leafId` 找 leaf，`pane.kind` 为 agent / terminal 才算；插件面板等组件节点没有 leafId，排除。
 * - 名字：`node.name`，没起名按种类各自计数兜底「AI 对话 N」「终端 N」（同 BoardStage 的口径）。
 */
export function frameInjectTargets(
  frame: { nodes: readonly { id: string; leafId?: string; name?: string }[] },
  leaves: readonly { id: string; pane: { kind: string; ptyId?: string } }[]
): InjectTarget[] {
  const byId = new Map(leaves.map((l) => [l.id, l]))
  const seen = { agent: 0, terminal: 0 }
  const out: InjectTarget[] = []
  for (const n of frame.nodes) {
    const leaf = n.leafId ? byId.get(n.leafId) : undefined
    if (!leaf || (leaf.pane.kind !== 'agent' && leaf.pane.kind !== 'terminal')) continue
    const kind = leaf.pane.kind
    seen[kind]++
    const name = n.name?.trim() || (kind === 'agent' ? `AI 对话 ${seen.agent}` : `终端 ${seen.terminal}`)
    out.push(kind === 'terminal' ? { nodeId: n.id, leafId: leaf.id, kind, name, ptyId: leaf.pane.ptyId } : { nodeId: n.id, leafId: leaf.id, kind, name })
  }
  return out
}
