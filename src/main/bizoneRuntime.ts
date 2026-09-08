import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

export interface BizoneInstallation { app: string; server: string; executable: string }
export interface BizoneRuntimeOptions {
  platform?: NodeJS.Platform
  home?: string
  appData?: string
  /** Trusted, explicitly verified installation locations only. No Windows guesses. */
  candidates?: BizoneInstallation[]
  discover?: () => Promise<BizoneInstallation | undefined>
  exists?: (file: string) => boolean
  read?: (file: string) => string | undefined
  probe?: (port: number, timeoutMs: number) => Promise<boolean>
  launch?: (command: string, args: string[], env: Record<string, string>) => Promise<void>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}
function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}
/** Deliberate allowlist: never inherit model keys, gateway secrets, or endpoint overrides. */
export function bizoneClientEnv(tokenFile: string, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ['HOME', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (source[key] !== undefined) env[key] = source[key]!
  }
  env.TAPTV_TOKEN_FILE = tokenFile
  return env
}
function probeHealth(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (ready: boolean): void => { clearTimeout(timer); resolve(ready) }
    const request = http.get({ hostname: '127.0.0.1', port, path: '/health' }, response => {
      let body = ''
      response.on('data', chunk => {
        body += chunk.toString()
        if (body.length > 8192) { request.destroy(); finish(false) }
      })
      response.on('error', () => finish(false))
      response.on('end', () => {
        try {
          const result = JSON.parse(body)
          finish(response.statusCode === 200 && result.status === 'ok' && typeof result.version === 'string' && Number.isInteger(result.tools))
        } catch { finish(false) }
      })
    })
    // Absolute deadline, not socket inactivity: a slow stream cannot extend startup.
    timer = setTimeout(() => { request.destroy(); finish(false) }, timeoutMs)
    request.on('error', () => finish(false))
  })
}
function launchApp(command: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'ignore', detached: true, shell: false })
    child.once('error', () => reject(failure('BIZONE_LAUNCH_FAILED', '笔纵画板启动失败')))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

/** Reads local installation state only at construction/discovery. GUI startup occurs
 * exclusively in ensureRunning. Local API readiness does NOT imply model-account login. */
export function createBizoneRuntime(options: BizoneRuntimeOptions = {}) {
  const platform = options.platform ?? process.platform
  const home = options.home ?? os.homedir()
  const paths = platform === 'win32' ? path.win32 : path.posix
  const tokenFile = platform === 'darwin'
    ? paths.join(home, 'Library', 'Application Support', '笔纵画板', 'api-token.json')
    : platform === 'win32'
      ? paths.join(options.appData ?? process.env.APPDATA ?? paths.join(home, 'AppData', 'Roaming'), '笔纵画板', 'api-token.json')
      : paths.join(home, '.config', '笔纵画板', 'api-token.json')
  let candidates = options.candidates ?? (platform === 'darwin' ? ['/Applications/笔纵画板.app', paths.join(home, 'Applications', '笔纵画板.app')].map(app => ({
    app, server: paths.join(app, 'Contents/Resources/app/electron/mcpServer.js'), executable: paths.join(app, 'Contents/MacOS/笔纵画板')
  })) : [])
  const exists = options.exists ?? fs.existsSync
  const read = options.read ?? ((file: string) => {
    try { return fs.readFileSync(file, 'utf8') } catch { return undefined }
  })
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const probe = options.probe ?? probeHealth
  const launch = options.launch ?? launchApp
  let discovery: Promise<void> | undefined
  function refreshInstallation(): Promise<void> {
    if (!options.discover) return Promise.resolve()
    discovery ??= options.discover().then(item => { candidates = item ? [item] : [] }, () => { candidates = [] }).finally(() => { discovery = undefined })
    return discovery
  }
  function installed(): BizoneInstallation | undefined {
    return candidates.find(item => exists(item.server) && exists(item.executable) && exists(paths.join(paths.dirname(item.server), '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json')))
  }
  function endpoint(): { port: number; revision: string } {
    const raw = read(tokenFile)
    if (raw === undefined) throw failure('BIZONE_AUTH_MISSING', '笔纵画板本地认证文件尚未创建')
    try {
      const data = JSON.parse(raw)
      if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535 || typeof data.token !== 'string' || !data.token.trim()) throw new Error()
      return { port: data.port, revision: crypto.createHash('sha256').update(JSON.stringify([data.port, data.token])).digest('hex') }
    } catch { throw failure('BIZONE_AUTH_INVALID', '笔纵画板本地认证文件格式无效') }
  }
  async function ensureRunning(): Promise<{ revision: string }> {
    await refreshInstallation()
    const info = installed()
    if (!info) throw failure('BIZONE_MISSING', '未找到已验证的笔纵画板应用及正式 MCP 依赖')
    const deadline = now() + 12_000
    let launched = false
    let lastError: unknown
    while (now() < deadline) {
      try {
        const current = endpoint()
        lastError = undefined
        if (await probe(current.port, Math.max(1, Math.min(750, deadline - now())))) return { revision: current.revision }
      } catch (error) { lastError = error }
      if (!launched) {
        launched = true
        const env = bizoneClientEnv(tokenFile)
        if (platform === 'darwin') await launch('/usr/bin/open', ['-g', '-a', info.app], env)
        else if (platform === 'win32') await launch(info.executable, [], env)
        else throw failure('BIZONE_MISSING', '此平台尚无已验证的笔纵画板启动方式')
      }
      const remaining = deadline - now()
      if (remaining > 0) await sleep(Math.min(250, remaining))
    }
    if (lastError) throw lastError
    throw failure('BIZONE_TIMEOUT', '笔纵画板本地服务未在 12 秒内就绪')
  }
  return { installed, tokenFile, ensureRunning, refreshInstallation }
}
