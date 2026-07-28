// MCP 桥：把画板能力开放给跑在本 app 终端里的 AI（Claude Code / Codex）。
//
// 链路：Claude ──stdio──▸ mcp/eas-mcp.mjs ──HTTP+token──▸ 这里 ──IPC──▸ 渲染进程 store
//
// 安全三道锁：① 只监听 127.0.0.1；② 随机 token，只经 PTY env 注入给本 app 自己起的终端；
// ③ 路径白名单（open_file/open_html 只允许项目目录内），防止把 ~/.ssh 之类渲染出来。
import { app, BrowserWindow, ipcMain } from 'electron'
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

interface Ctx {
  /** 调用方所在终端的 ptyId：渲染层据此反查「我在哪个 Frame / 哪个节点」
   *  （终端是先创建 pty、之后才挂到 Frame 节点上的，spawn 时还不知道 frameId，所以注入 ptyId 更可靠） */
  ptyId?: string
  project?: string
}
interface InvokeResult {
  ok: boolean
  data?: unknown
  error?: string
}

let server: http.Server | null = null
let port = 0
let token = ''
let seq = 1
const pending = new Map<number, (r: InvokeResult) => void>()

export function mcpEnv(ctx: Ctx): Record<string, string> {
  if (!port || !token) return {}
  const env: Record<string, string> = {
    EAS_TERM_PORT: String(port),
    EAS_TERM_TOKEN: token
  }
  if (ctx.ptyId) env.EAS_PTY_ID = ctx.ptyId
  if (ctx.project) env.EAS_PROJECT = ctx.project
  return env
}

// 把一次工具调用转给渲染进程执行（store action 都在那边），等它回结果
function invokeRenderer(tool: string, args: unknown, ctx: Ctx): Promise<InvokeResult> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) return Promise.resolve({ ok: false, error: '窗口未就绪' })
  const id = seq++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) resolve({ ok: false, error: '渲染层超时未响应' })
    }, 15000)
    pending.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    win.webContents.send('mcp:invoke', { id, tool, args, ctx })
  })
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (c) => {
      b += c
      if (b.length > 1_000_000) reject(new Error('body 过大'))
    })
    req.on('end', () => resolve(b))
    req.on('error', reject)
  })
}

function serverScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'eas-mcp.mjs')
    : path.join(app.getAppPath(), 'mcp', 'eas-mcp.mjs')
}

/** MCP server 的运行方式：优先用系统 node（纯脚本零依赖，进程轻）；
 *  找不到就用 app 自带的 Electron 以 node 模式跑，保证任何机器上都能启动。
 *  注意主进程在 GUI 启动时 PATH 很贫瘠（/usr/bin:/bin:...），所以是探路径而不是 which。 */
function runnerFor(serverPath: string): { command: string; args: string[]; env?: Record<string, string> } {
  const candidates =
    process.platform === 'win32'
      ? []
      : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return { command: c, args: [serverPath] }
    } catch {
      /* 探测失败就试下一个 */
    }
  }
  return { command: process.execPath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** 把 eas-term 写进用户级 Claude 配置（~/.claude.json 的 mcpServers）。
 *
 *  为什么敢写全局：MCP server 在检测不到 Eas-Term 环境（没有 PTY 注入的端口/令牌）时
 *  tools/list 直接返回空 —— 用户在 app 外面起 claude 看不到任何多余工具，零认知负担。
 *  端口/令牌不写进配置，只走 PTY 环境变量，所以这条配置本身不含任何敏感信息。
 *
 *  为什么不靠 PATH shim：shim 目录是在 shell 启动**之前**塞进 PATH 的，用户 .zshrc 里
 *  一句 export PATH="$HOME/.local/bin:$PATH" 就能把它挤到后面——而 Claude Code 官方安装
 *  脚本默认就装在 ~/.local/bin。实测确认会被绕过，所以那条路走不通。 */
function writeClaudeConfig(serverPath: string): void {
  try {
    const home = app.getPath('home')
    const cfgFile = path.join(home, '.claude.json')
    // 没装 Claude Code 就别碰用户的 home——否则从没用过 claude 的人也会凭空
    // 多出一个 ~/.claude.json。判据取「配置文件或 ~/.claude 目录任一存在」，
    // 跟 writeCodexConfig 检查 ~/.codex 目录是一个道理。
    if (!fs.existsSync(cfgFile) && !fs.existsSync(path.join(home, '.claude'))) return
    let cfg: Record<string, unknown> = {}
    if (fs.existsSync(cfgFile)) {
      // 关键：文件存在但读不动/解析失败时**绝不写**——否则会把用户整份 Claude 配置覆盖没
      try {
        cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) as Record<string, unknown>
      } catch (e) {
        console.error('[mcp] ~/.claude.json 解析失败，跳过自动配置(不冒险覆盖)', e)
        return
      }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
        console.error('[mcp] ~/.claude.json 结构异常，跳过自动配置')
        return
      }
    }
    const servers = (cfg.mcpServers ?? {}) as Record<string, unknown>
    const r = runnerFor(serverPath)
    const desired = { type: 'stdio', command: r.command, args: r.args, ...(r.env ? { env: r.env } : {}) }
    if (JSON.stringify(servers['eas-term']) === JSON.stringify(desired)) return // 无变化不写盘
    servers['eas-term'] = desired
    cfg.mcpServers = servers
    if (fs.existsSync(cfgFile)) {
      try {
        fs.copyFileSync(cfgFile, cfgFile + '.eas-backup')
      } catch {
        /* 备份失败不阻断：下面写的是「已解析成功的完整对象」，不会丢字段 */
      }
    }
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2))
    console.log('[mcp] 已配置 Claude Code（~/.claude.json）')
  } catch (e) {
    console.error('[mcp] 写 Claude 配置失败(可手动配置)', e)
  }
}

/** 把 eas-term 写进 ~/.codex/config.toml。
 *  没有 TOML 库，所以**不解析整个文件**——只按行定位自己那一段做替换/追加，
 *  用户的其它配置一个字符都不碰（解析再序列化会丢注释和格式）。
 *
 *  这里刻意不用正则：`[^[]*` 那种写法会被 `args = [...]` 里的方括号截断，
 *  导致只替换掉半段、把后半截留成一行孤立的 `["..."]`（TOML 里那是个 table header，
 *  等于每次启动往用户配置里塞一行垃圾）。按行扫描没有这个坑。 */
function writeCodexConfig(serverPath: string): void {
  try {
    const dir = path.join(app.getPath('home'), '.codex')
    const cfgFile = path.join(dir, 'config.toml')
    if (!fs.existsSync(dir)) return // 没装/没用过 Codex 就别给人家建目录

    const r = runnerFor(serverPath)
    const q = (v: string): string => JSON.stringify(v) // TOML 基本字符串的转义规则与 JSON 兼容
    const HEAD = '[mcp_servers.eas-term]'
    const blockLines = [HEAD, `command = ${q(r.command)}`, `args = [${r.args.map(q).join(', ')}]`]
    if (r.env) {
      blockLines.push(
        `env = { ${Object.entries(r.env).map(([k, v]) => `${k} = ${q(v)}`).join(', ')} }`
      )
    }

    const raw = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : ''
    const lines = raw.length ? raw.split('\n') : []
    const at = lines.findIndex((l) => l.trim() === HEAD)

    let next: string[]
    if (at >= 0) {
      // 段尾 = 下一个「行首是 [」的行（TOML 的 table header 必须顶格起）
      let end = at + 1
      while (end < lines.length && !lines[end].trimEnd().startsWith('[')) end++
      // 段尾的空行和注释要退回去：注释惯例是写在**下一个** table 上方（用户那句
      // 「# ─── 笔纵画板 ───」就属于下面的 bizone-canvas），吃掉它等于删用户的注释
      while (end > at + 1) {
        const prev = lines[end - 1].trim()
        if (prev === '' || prev.startsWith('#')) end--
        else break
      }
      const cur = lines.slice(at, end).map((l) => l.trimEnd()).filter(Boolean)
      if (cur.join('\n') === blockLines.join('\n')) return // 无变化不写盘
      const after = lines.slice(end)
      // 后面还有内容且不是以空行起头，补一个空行隔开
      if (after.length && after[0].trim()) after.unshift('')
      next = [...lines.slice(0, at), ...blockLines, ...after]
    } else {
      next = [...lines]
      while (next.length && !next[next.length - 1].trim()) next.pop()
      if (next.length) next.push('')
      next.push(...blockLines, '')
    }

    if (raw) {
      try {
        fs.copyFileSync(cfgFile, cfgFile + '.eas-backup')
      } catch {
        /* 备份失败不阻断 */
      }
    }
    fs.writeFileSync(cfgFile, next.join('\n'))
    console.log('[mcp] 已配置 Codex（~/.codex/config.toml）')
  } catch (e) {
    console.error('[mcp] 写 Codex 配置失败(可手动配置)', e)
  }
}

/** 清掉上一版留下的 claude / codex 包装脚本（PATH shim 方案已废弃，见 writeClaudeConfig 注释）。
 *  只删自己写的那两个文件，同目录的 open shim 还在用，不能碰。 */
function removeLegacyAgentShims(): void {
  for (const name of ['claude', 'codex']) {
    try {
      const f = path.join(app.getPath('userData'), 'bin', name)
      if (!fs.existsSync(f)) continue
      if (!fs.readFileSync(f, 'utf8').includes('Eas-Term')) continue // 不是自己写的就别删
      fs.unlinkSync(f)
      console.log('[mcp] 已移除旧的 ' + name + ' 包装脚本')
    } catch {
      /* 删不掉也无害：脚本本身能正常转发，只是多一层 */
    }
  }
}

function setupAgents(): void {
  const serverPath = serverScriptPath()
  if (!fs.existsSync(serverPath)) return
  removeLegacyAgentShims()
  writeClaudeConfig(serverPath)
  writeCodexConfig(serverPath)
}

export function registerMcpBridge(): void {
  ipcMain.on('mcp:result', (_e, r: { id: number; ok: boolean; data?: unknown; error?: string }) => {
    const done = pending.get(r.id)
    if (done) {
      pending.delete(r.id)
      done({ ok: r.ok, data: r.data, error: r.error })
    }
  })

  token = crypto.randomBytes(24).toString('hex')
  server = http.createServer(async (req, res) => {
    const send = (code: number, obj: unknown): void => {
      const body = JSON.stringify(obj)
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
      res.end(body)
    }
    try {
      // token 校验（health 除外，方便排查）
      if (req.url === '/health') return send(200, { ok: true, port })
      if (req.headers['x-eas-token'] !== token) return send(401, { ok: false, error: 'token 无效' })
      if (req.method !== 'POST' || req.url !== '/invoke')
        return send(404, { ok: false, error: '未知路径' })

      const raw = await readBody(req)
      const { tool, args, ctx } = JSON.parse(raw || '{}') as {
        tool: string
        args?: unknown
        ctx?: Ctx
      }
      if (!tool) return send(400, { ok: false, error: '缺少 tool' })
      const r = await invokeRenderer(tool, args ?? {}, ctx ?? {})
      send(r.ok ? 200 : 400, r)
    } catch (e) {
      send(500, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  server.listen(0, '127.0.0.1', () => {
    const addr = server?.address()
    port = typeof addr === 'object' && addr ? addr.port : 0
    // 端口/token 落盘，供外部（如手动配置 MCP）读取；权限 600
    try {
      const f = path.join(app.getPath('userData'), 'mcp-endpoint.json')
      fs.writeFileSync(f, JSON.stringify({ port, token }), { mode: 0o600 })
    } catch (e) {
      console.error('[mcp] 写 endpoint 文件失败', e)
    }
    setupAgents()
    console.log('[mcp] bridge listening on 127.0.0.1:' + port)
  })

  app.on('will-quit', () => {
    server?.close()
    server = null
  })
}
