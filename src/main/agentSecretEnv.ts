import path from 'path'
import { issueSecretToken, autoInjectGroups } from './secrets'
import { ensureSecretShim } from './secretShim'

/** 只发凭证，不调用 secretsEnv，不把业务密钥注入 agent。必须在所有 env merge 后调用。 */
export function withAgentSecrets(sessionKey: string, input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input }
  const dir = ensureSecretShim()
  if (!dir) throw new Error('无法创建 eas-secret 包装命令，请重试会话')
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
  env[key] = env[key] ? `${dir}${path.delimiter}${env[key]}` : dir
  env.EAS_SECRET_TOKEN = issueSecretToken(sessionKey, autoInjectGroups())
  return env
}
