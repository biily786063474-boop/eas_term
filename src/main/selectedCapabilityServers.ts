/** Normalize only the explicitly selected native plugin, before CLI compilation. */
import type { SessionMcpServer } from '../shared/builtinCapabilities.ts'
import path from 'node:path'
export function substitutePluginRoot(value: unknown, root: string): unknown {
  if (typeof value === 'string') return value.replace(/\$\{(?:CLAUDE|CODEX)_PLUGIN_ROOT\}/g, () => root)
  if (Array.isArray(value)) return value.map(item => substitutePluginRoot(item, root))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitutePluginRoot(item, root)]))
  return value
}
export function selectedNativeServers(plugin: { name: string; root: string; mcpServers?: Record<string, unknown> }): SessionMcpServer[] {
  const servers: SessionMcpServer[] = []
  for (const [name, raw] of Object.entries(plugin.mcpServers ?? {})) {
    const cfg = substitutePluginRoot(raw, plugin.root) as Record<string, unknown> | null
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`所选插件 MCP 配置无效：${name}`)
    if (cfg.enabled === false || cfg.disabled === true) continue
    if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean' || cfg.disabled !== undefined && typeof cfg.disabled !== 'boolean') throw new Error(`所选插件 MCP 禁用配置无效：${name}`)
    // These are not interchangeable across native CLI schemas. Reject before
    // either transport branch so remote settings cannot bypass this boundary.
    for (const field of ['disabled_tools', 'enabled_tools', 'allowedTools', 'disabledTools', 'tools', 'default_tools_approval_mode', 'permissions', 'approval_policy']) {
      if (cfg[field] !== undefined) throw new Error(`所选插件 MCP 工具限制尚不能安全转换：${name}`)
    }
    if (typeof cfg.url === 'string' && cfg.url && (cfg.type === undefined || cfg.type === 'http' || cfg.type === 'sse')) {
      const supported = new Set(['type', 'url', 'headers', 'http_headers', 'env_http_headers', 'env_headers', 'bearer_token_env_var', 'enabled', 'disabled'])
      for (const field of Object.keys(cfg)) if (!supported.has(field)) throw new Error(`所选插件 MCP 字段尚不能安全转换：${name}.${field}`)
      // Preserve pre-existing native transport/auth fields exactly; never compile
      // secret HTTP headers into Codex argv or pretend ACP accepts remote servers.
      servers.push({ name, command: '', nativeRemote: cfg })
      continue
    }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`所选插件 MCP 名称暂不兼容三端：${name}`)
    if (cfg.type !== undefined && cfg.type !== 'stdio' || typeof cfg.command !== 'string' || !cfg.command || cfg.url !== undefined) throw new Error(`所选插件 MCP 传输配置无效：${name}`)
    const supported = new Set(['type', 'command', 'args', 'env', 'env_vars', 'cwd', 'enabled', 'disabled'])
    for (const field of Object.keys(cfg)) if (!supported.has(field)) throw new Error(`所选插件 MCP 字段尚不能安全转换：${name}.${field}`)
    let cwd: string | undefined
    if (cfg.cwd !== undefined) {
      if (typeof cfg.cwd !== 'string' || !path.isAbsolute(cfg.cwd) || cfg.cwd.includes('\0')) throw new Error(`所选插件 MCP 工作目录必须是当前平台绝对路径：${name}`)
      cwd = path.normalize(cfg.cwd)
      if (process.platform === 'win32' && !/^(?:[A-Za-z]:\\|\\\\[^\\/?]+\\[^\\/?]+(?:\\|$))/.test(cwd)) throw new Error(`所选插件 MCP 工作目录必须包含盘符或共享根目录：${name}`)
    }
    if (cfg.args !== undefined && (!Array.isArray(cfg.args) || cfg.args.some(arg => typeof arg !== 'string'))) throw new Error(`所选插件 MCP 参数无效：${name}`)
    if (cfg.env !== undefined && (!cfg.env || typeof cfg.env !== 'object' || Array.isArray(cfg.env) || Object.values(cfg.env).some(value => typeof value !== 'string'))) throw new Error(`所选插件 MCP 环境配置无效：${name}`)
    if (cfg.env_vars !== undefined && (!Array.isArray(cfg.env_vars) || cfg.env_vars.some(value => typeof value !== 'string'))) throw new Error(`所选插件 MCP 环境转发无效：${name}`)
    servers.push({ name, command: cfg.command, ...(cfg.args ? { args: [...cfg.args as string[]] } : {}),
      ...(cwd ? { cwd } : {}),
      ...(cfg.env ? { env: { ...cfg.env as Record<string, string> } } : {}),
      ...(cfg.env_vars ? { envVars: [...cfg.env_vars as string[]] } : {}) })
  }
  return servers
}
export function capabilityMcpConfig(servers: readonly SessionMcpServer[]): Record<string, unknown> {
  return Object.fromEntries(servers.map(({ name, command, args, env, cwd, nativeRemote }) => [name, nativeRemote ? structuredClone(nativeRemote) : { type: 'stdio', command, args: args ?? [], ...(cwd ? { cwd } : {}), ...(env ? { env: { ...env } } : {}) }]))
}
