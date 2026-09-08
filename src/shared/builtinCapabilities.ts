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
export function capabilitySummary(state: CapabilityState): string {
  if (!state.enabled) return '已禁用'
  if (state.dependency === 'missing') return '依赖未安装'
  if (state.dependency === 'unauthenticated') return '需要登录'
  if (state.dependency === 'unavailable') return '依赖服务不可用'
  if (state.session === 'ready') return state.toolCount ? `已就绪 · ${state.toolCount} 个工具` : '握手成功但没有工具'
  return { 'not-requested': '尚未连接', waiting: '等待服务', failed: '握手失败', reconnecting: '正在恢复连接' }[state.session]
}
