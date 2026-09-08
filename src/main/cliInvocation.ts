// Same resolver as the owned PTY/Codex launchers; interpreter authority stays here.
import { resolveCliInvocation, type CliInvocation } from '../../mcp/cli-entry.mjs'
import { nodeRunner } from './nodeBin.ts'
import { PROBE_ENV } from './probeEnv.ts'
export function cliInvocation(kind: string, binary: string, args: string[], env: NodeJS.ProcessEnv = PROBE_ENV): CliInvocation {
  return resolveCliInvocation(kind, binary, args, env, nodeRunner([]))
}
export { cliInvocationEnv } from '../../mcp/cli-entry.mjs'
