import path from 'node:path'
import { nodeRunner, type NodeRunner } from './nodeBin.ts'

/** The owned launcher resolves native configuration before model execution.
 * This keeps asynchronous preflight inside the existing process lifecycle. */
export function codexCapabilityLaunch(binary: string, args: string[], host: {
  isPackaged: boolean; appPath: string; resourcesPath: string; electron: string; platform?: NodeJS.Platform
}, options?: { managedAssignments: string[] }): NodeRunner {
  const root = host.isPackaged ? host.resourcesPath : host.appPath
  const runner = nodeRunner([path.join(root, 'mcp', 'eas-codex-launcher.mjs'), JSON.stringify({ binary, args, ...options })], {
    electron: host.electron, platform: host.platform
  })
  return { ...runner, ...(runner.env ? { env: { ...runner.env, EAS_CAPABILITY_NODE_FALLBACK: '1' } } : {}) }
}
