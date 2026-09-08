import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** Root is an app-owned directory, never a renderer-supplied write path. Snapshots contain configuration, not authority. */
export function writeCapabilitySnapshot(root: string, sessionKey: string, servers: Record<string, unknown>): string {
  const content = JSON.stringify({ mcpServers: servers }, null, 2) + '\n'
  const digest = crypto.createHash('sha256').update(sessionKey).update('\0').update(content).digest('hex')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = path.join(root, digest + '.json')
  try {
    fs.writeFileSync(file, content, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (!fs.lstatSync(file).isFile() || fs.readFileSync(file, 'utf8') !== content) throw new Error('会话配置快照校验失败')
  }
  return file
}
