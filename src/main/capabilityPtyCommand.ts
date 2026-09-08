import path from 'node:path'
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
  const flags = ['--mcp-config', capabilities.configPath]
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
  return { command: invocation.binary, args: [...flags, ...args] }
}
