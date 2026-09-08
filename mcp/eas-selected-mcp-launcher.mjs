/** App-owned immutable snapshot launcher. Never receives raw plugin configuration in argv. */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
const [snapshotPath, serverName] = process.argv.slice(2)
let child
try {
  if (!snapshotPath || !path.isAbsolute(snapshotPath) || !serverName) throw new Error('Invalid snapshot')
  const stat = fs.lstatSync(snapshotPath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Invalid snapshot')
  const cfg = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).mcpServers?.[serverName]
  if (!cfg || typeof cfg.command !== 'string' || !cfg.command || !Array.isArray(cfg.args) || cfg.args.some(a => typeof a !== 'string') ||
      cfg.env && (typeof cfg.env !== 'object' || Array.isArray(cfg.env) || Object.values(cfg.env).some(v => typeof v !== 'string'))) throw new Error('Invalid server')
  let cwd
  if (cfg.cwd !== undefined) {
    if (typeof cfg.cwd !== 'string' || !path.isAbsolute(cfg.cwd) || cfg.cwd.includes('\0')) throw new Error('Invalid working directory')
    cwd = path.normalize(cfg.cwd)
    if (process.platform === 'win32' && !/^(?:[A-Za-z]:\\|\\\\[^\\/?]+\\[^\\/?]+(?:\\|$))/.test(cwd)) throw new Error('Invalid working directory')
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Working directory unavailable')
  }
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  // A selected native plugin is not an Eas gateway shim and gets no app authority.
  for (const key of Object.keys(env)) if (key.startsWith('EAS_')) delete env[key]
  Object.assign(env, cfg.env ?? {})
  child = spawn(cfg.command, cfg.args, { env, ...(cwd ? { cwd } : {}), stdio: 'inherit', windowsHide: true })
  child.once('error', () => { process.stderr.write('所选 MCP 执行体启动失败\n'); process.exitCode = 1 })
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
  const stop = signal => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    child.kill(signal)
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 1000).unref()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
} catch {
  process.stderr.write('所选 MCP 启动快照不可用\n')
  process.exitCode = 1
}
