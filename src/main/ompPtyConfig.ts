/** Managed PTY uses the same config/auth directory as AI chat. No credentials cross HTTP. */
import fs from 'node:fs'
import type { HostPaths } from '../shared/agentChat.ts'
import { ompBaseEnv, ompBinPath } from './agentChat/omp/paths.ts'
import { writeManagedConfig } from './agentChat/omp/launch.ts'
export function prepareOmpPtyConfig(host: HostPaths, binary: string, args: readonly string[], guidanceEnabled: boolean): Record<string, string> {
  if (fs.realpathSync(binary) !== fs.realpathSync(ompBinPath(host))) throw new Error('受管 OMP 只允许使用随包执行体')
  for (const arg of args) {
    if (arg === '--') break
    if (/^--(?:profile|session-dir)(?:=|$)/.test(arg)) throw new Error('受管 OMP 不支持覆盖配置或会话目录；请使用应用内的账号与会话设置')
  }
  writeManagedConfig(host, { guidanceEnabled })
  const env = ompBaseEnv(host)
  return Object.fromEntries(['HOME', 'PI_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'OMP_SKIP_SETUP'].map(key => [key, env[key]]))
}
