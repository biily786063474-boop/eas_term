import path from 'node:path'
import { cliInvocation } from './cliInvocation.ts'
import { codexAddServerArgs } from '../shared/roleBinding.ts'
import type { SessionMcpServer } from '../shared/builtinCapabilities.ts'
import { codexCapabilityLaunch } from './codexCapabilityLaunch.ts'
import type { NodeRunner } from './nodeBin.ts'

export interface PtyCapabilityInvocation {
  kind: 'claude' | 'codex' | 'omp'
  binary: string
  args: string[]
  cwd: string
}
/** Resolve native cwd flags before issuing authority. The original argv remains intact. */
export function capabilityInvocationCwd(invocation: PtyCapabilityInvocation): string {
  let cwd = invocation.cwd
  const flags = invocation.kind === 'codex' ? ['-C', '--cd'] : invocation.kind === 'omp' ? ['--cwd'] : []
  for (let i = 0; i < invocation.args.length; i++) {
    const arg = invocation.args[i]
    if (arg === '--') break
    if (invocation.kind === 'codex' && arg.startsWith('-C') && arg.length > 2) {
      cwd = path.resolve(invocation.cwd, arg.slice(2))
      continue
    }
    const name = flags.find(flag => arg === flag || arg.startsWith(flag + '='))
    if (!name) continue
    const value = arg === name ? invocation.args[++i] : arg.slice(name.length + 1)
    if (!value || value.includes('\0')) throw new Error('CLI 工作目录参数无效')
    cwd = path.resolve(invocation.cwd, value)
  }
  return cwd
}

/** 默认能力里预先放行的工具（2026-09-28 用户拍板，只放这一个）。
 *  「汇报页提交到画布」是 Eas-Term 自带能力的出口，自动模式把它当成未知 MCP 拦下，
 *  用户每次都得手动放行。只在受管启动时带 —— eas-term 这个 MCP 本来就只存在于受管会话，
 *  不写用户全局 settings.json。对话模块不走这里：它的审批统一走审批卡片。 */
export const CLAUDE_PREAPPROVED_TOOLS = ['mcp__eas-term__canvas_publish_report'] as const

export function buildPtyCapabilityCommand(invocation: PtyCapabilityInvocation, capabilities: {
  servers: SessionMcpServer[]; configPath: string; guidance: string; ompExtension?: string
}, host: Parameters<typeof codexCapabilityLaunch>[2]): NodeRunner {
  const args = [...invocation.args]
  if (invocation.kind === 'codex') {
    const configs = capabilities.servers.flatMap(server => codexAddServerArgs(server))
    if (capabilities.guidance) configs.push('instructions=' + JSON.stringify(capabilities.guidance))
    return codexCapabilityLaunch(invocation.binary, args, host, { managedAssignments: configs })
  }
  if (invocation.kind === 'omp') {
    return { command: invocation.binary, args: [...(capabilities.ompExtension ? ['--extension', capabilities.ompExtension] : []), ...(capabilities.guidance ? ['--append-system-prompt', capabilities.guidance] : []), ...args] }
  }
  const append = args.findIndex(arg => arg === '--append-system-prompt')
  // `--allowedTools` 是变长参数（实测会把后面的提问文字吞成工具名），必须紧跟另一个选项。
  const allow = capabilities.servers.some(server => server.name === 'eas-term') ? ['--allowedTools', ...CLAUDE_PREAPPROVED_TOOLS] : []
  const flags = [...allow, '--mcp-config', capabilities.configPath]
  if (capabilities.guidance) {
    if (append >= 0) {
      if (typeof args[append + 1] !== 'string') throw new Error('缺少 Claude 指引参数')
      args[append + 1] += '\n\n' + capabilities.guidance
    } else if (args.some(arg => arg.startsWith('--append-system-prompt='))) {
      const at = args.findIndex(arg => arg.startsWith('--append-system-prompt='))
      args[at] += '\n\n' + capabilities.guidance
    } else if (args.includes('--append-system-prompt-file')) {
      // Never override a user-owned instructions file with a second conflicting flag.
      throw new Error('此 Claude 启动参数需要合并指引文件后才能启用内置能力')
    } else flags.push('--append-system-prompt', capabilities.guidance)
  }
  return cliInvocation('claude', invocation.binary, [...flags, ...args])
}
