import type { StartOpts } from '../../../../shared/agentChat.ts'

export const DEFAULT_STARTUP_SANDBOX = 'danger-full-access'

/** 用户指定启动页默认完全放开；角色写限制优先，未知值回到工作区限制。 */
export function startupSandboxParams(cli?: string, choice: string = DEFAULT_STARTUP_SANDBOX, readOnlyRole = false): Pick<StartOpts, 'sandbox'> {
  if (cli !== 'codex') return {}
  const sandbox = readOnlyRole ? 'read-only'
    : ['read-only', 'workspace-write', 'danger-full-access'].includes(choice ?? '') ? choice! : 'workspace-write'
  return { sandbox }
}
