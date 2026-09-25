/** Pure authorization and input limits for the local development observer. */
export interface LivePageContext {
  agentLeafId?: string
  agentSessionId?: string
  ptyId?: string
  project?: string
}

export function livePageOwner(ctx: LivePageContext): string {
  if (typeof ctx.agentLeafId === 'string' && ctx.agentLeafId.trim()) return 'leaf:' + ctx.agentLeafId.trim()
  if (typeof ctx.agentSessionId === 'string' && ctx.agentSessionId.trim()) return 'agent:' + ctx.agentSessionId.trim()
  if (typeof ctx.ptyId === 'string' && ctx.ptyId.trim()) return 'pty:' + ctx.ptyId.trim()
  throw new Error('页面观察窗需要已绑定的 AI 对话或终端会话')
}

export function localPageUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('网页地址无效')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('网页地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('页面观察窗仅允许本机开发服务器地址')
  }
  return url
}

export function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('操作坐标应在 0–1 范围内')
  return value
}

export function safeText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 10_000) throw new Error('输入文字超过长度限制')
  return value
}
