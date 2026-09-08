/** OMP owns OAuth callbacks, token exchange, persistence and refresh. UI only presents its requests. */
export interface OmpLoginState {
  provider: string
  phase: 'starting' | 'browser' | 'input' | 'working' | 'done' | 'failed' | 'cancelled'
  url?: string
  launchUrl?: string
  prompt?: string
  progress?: string
  instructions?: string
  /** Sanitized diagnostic messages only; never authorization URLs / raw output. */
  lines: string[]
  error?: string
}

/** Navigation only. A pasted code/redirect is NOT a navigation URL. */
export function ompLoginUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw)
    if (u.username || u.password) return undefined
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) return u.href
  } catch { /* not a navigation URL */ }
  return undefined
}

export function ompPromptKind(prompt?: string): 'secret' | 'code' | 'text' {
  if (/api[ -]?key|access token|secret|password/i.test(prompt ?? '')) return 'secret'
  if (/authorization code|redirect|callback|auth code/i.test(prompt ?? '')) return 'code'
  return 'text'
}
