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

// 把 eas-term MCP server 写进用户级 Claude 配置（~/.claude.json 的 mcpServers），
// 这样在本 app 任意终端里起 Claude Code 都能直接用；端口/token 走 PTY env，不写死在配置里。
function writeUserMcpConfig(): void {
  try {
    const serverPath = app.isPackaged
      ? path.join(process.resourcesPath, 'mcp', 'eas-mcp.mjs')
      : path.join(app.getAppPath(), 'mcp', 'eas-mcp.mjs')
    if (!fs.existsSync(serverPath)) return
    const cfgFile = path.join(app.getPath('home'), '.claude.json')
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
    const desired = { type: 'stdio', command: process.execPath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } }
    if (JSON.stringify(servers['eas-term']) === JSON.stringify(desired)) return // 无变化不写盘
    servers['eas-term'] = desired
    cfg.mcpServers = servers
    // 改用户全局配置前先备份一份，出问题能回滚
    if (fs.existsSync(cfgFile)) {
      try {
        fs.copyFileSync(cfgFile, cfgFile + '.eas-backup')
      } catch {
        /* 备份失败不阻断，但下面的写入仍是「已解析成功的完整对象」，不会丢字段 */
      }
    }
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2))
    console.log('[mcp] 已写入 ~/.claude.json 的 mcpServers.eas-term')
  } catch (e) {
    console.error('[mcp] 写 Claude 配置失败(可手动配置)', e)
  }
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
    writeUserMcpConfig()
    console.log('[mcp] bridge listening on 127.0.0.1:' + port)
  })

  app.on('will-quit', () => {
    server?.close()
    server = null
  })
}
