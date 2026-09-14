import path from 'node:path'
import { createBizoneRuntime, bizoneClientEnv } from './bizoneRuntime.ts'
import { createBizoneConnector, type BizoneClient, type BizoneConnectorDeps } from './bizoneConnector.ts'
import { createBizoneGenerationGuard } from './bizoneGenerationGuard.ts'
import { McpClient, type McpClientOpts } from './mcpClient.ts'
import { nodeRunner, type NodeRunner } from './nodeBin.ts'
import { startManagedSession } from './runtime/sessionStartup.ts'

/** Trusted production assembly; neither plugin manifests nor leases supply executable paths. */
export function createBizoneHosted(options: {
  appOwnedDataDir: string
  version: string
  runtime?: Pick<ReturnType<typeof createBizoneRuntime>, 'installed' | 'tokenFile' | 'ensureRunning'> & { refreshInstallation?: () => Promise<void> }
  runner?: (args: string[]) => NodeRunner
  client?: (options: McpClientOpts) => BizoneClient
  /** 测试注入；生产默认应用级 startManagedSession（宿主跨会话共享，任何窗口无权替别人取消）。 */
  admit?: BizoneConnectorDeps['admit']
}) {
  const runtime = options.runtime ?? createBizoneRuntime()
  const connector = createBizoneConnector({
    version: options.version,
    backend: runtime,
    admit: options.admit ?? (opts => startManagedSession({ ...opts, windowId: null, projectId: null })),
    createClient: () => {
      const installed = runtime.installed()
      if (!installed) throw Object.assign(new Error('未找到已验证的笔纵画板应用及正式 MCP 依赖'), { code: 'BIZONE_MISSING' })
      const run = (options.runner ?? nodeRunner)([installed.server])
      return (options.client ?? (opts => new McpClient(opts)))({
        name: 'builtin-bizone', command: run.command, args: run.args,
        env: { ...bizoneClientEnv(runtime.tokenFile), ...run.env },
        cwd: path.dirname(installed.server)
      })
    }
  })
  const guard = createBizoneGenerationGuard({ appOwnedDataDir: options.appOwnedDataDir, underlying: connector })
  return { ...guard, tools: async () => {
    await runtime.refreshInstallation?.()
    if (!runtime.installed()) throw Object.assign(new Error('未找到已验证的笔纵画板应用及正式 MCP 依赖'), { code: 'BIZONE_MISSING' })
    return guard.tools()
  } }

}
