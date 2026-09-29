import { translate, type I18nKey, type Params, type T } from './i18n/index.ts'
/** Shared description, not authority: only the main-process host grants a managed session access. */
export type CapabilityModule = 'workbench' | 'bizone' | 'guidance'
export type CapabilityPreferences = Record<CapabilityModule, boolean>
export interface CapabilityPreferenceSnapshot {
  preferences: CapabilityPreferences
  error?: string
}
export interface CapabilityBundle {
  schemaVersion: 1
  id: 'eas-capabilities'
  version: string
  displayName: string
  modules: Array<
    { id: 'workbench'; binding: 'workbench-gateway'; serverName: 'eas-term' } |
    { id: 'bizone'; binding: 'bizone-connector'; serverName: 'bizone-canvas' } |
    { id: 'guidance'; binding: 'managed-session-instructions' }
  >
}
export interface CapabilityState {
  enabled: boolean
  dependency: 'available' | 'missing' | 'unauthenticated' | 'unavailable'
  session: 'not-requested' | 'waiting' | 'ready' | 'failed' | 'reconnecting'
  toolCount?: number
}
export interface CapabilityBundleStatus {
  id: 'eas-capabilities'
  version: string
  displayName: string
  modules: Record<CapabilityModule, CapabilityState>
  error?: string
}
export interface SessionMcpServer {
  name: string
  command: string
  /** Compatibility-only remote entry: Claude receives the untouched config; Codex
   * keeps its existing native remote registration, and OMP reports unsupported. */
  nativeRemote?: Record<string, unknown>
  /** Native selected stdio cwd, kept inside the private launcher snapshot. */
  cwd?: string
  args?: string[]
  env?: Record<string, string>
  /** Names forwarded from a managed CLI process; never copy credential values into argv. */
  envVars?: string[]
}
export function assembleCapabilityServers(
  base: readonly { enabled: boolean; server: SessionMcpServer }[],
  selected: readonly SessionMcpServer[]
): SessionMcpServer[] {
  const names = new Set<string>()
  return [...base.filter(m => m.enabled).map(m => m.server), ...selected].map(server => {
    if (names.has(server.name)) throw new Error(`MCP 名称冲突：${server.name}`)
    names.add(server.name)
    return {
      ...server,
      ...(server.nativeRemote ? { nativeRemote: structuredClone(server.nativeRemote) } : {}),
      ...(server.args ? { args: [...server.args] } : {}),
      ...(server.env ? { env: { ...server.env } } : {}),
      ...(server.envVars ? { envVars: [...server.envVars] } : {})
    }
  })
}
/** 能力状态一句话。传入 t 时按界面语言；不传（主进程 / 旧测试）保持中文原文。 */
export function capabilitySummary(state: CapabilityState, t?: T): string {
  const tr = t ?? ((key: I18nKey, params?: Params) => translate('zh', key, params))
  if (!state.enabled) return tr('settings.builtin.sum.disabled')
  if (state.dependency === 'missing') return tr('settings.builtin.sum.depMissing')
  if (state.dependency === 'unauthenticated') return tr('settings.builtin.sum.needLogin')
  if (state.dependency === 'unavailable') return tr('settings.builtin.sum.depUnavailable')
  if (state.session === 'ready') return state.toolCount ? tr('settings.builtin.sum.ready', { n: state.toolCount }) : tr('settings.builtin.sum.readyNoTools')
  return tr(`settings.builtin.sum.session.${state.session}` as const)
}
