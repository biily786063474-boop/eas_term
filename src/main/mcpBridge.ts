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

/** 在 shim 目录里放 claude / codex 的包装脚本，让它们**启动时**带上 eas-term MCP。
 *
 *  为什么不写用户的 ~/.claude.json 和 ~/.codex/config.toml：
 *   · 那会污染全局——用户在本 app 之外起 claude 也会看到这堆用不了的工具（token 没注入）
 *   · 那要改用户的全局配置文件，卸载 app 后还残留
 *  包装脚本只作用于本 app 自己的终端（shim 目录只在 PTY 的 PATH 里），app 外一切照旧，
 *  用户两份全局配置一个字都不用改 —— 这就是「即插即用」。
 *
 *  找真程序时必须先把 shim 目录从 PATH 里剔除，否则包装脚本会递归调用自己。
 *  找不到真程序就原样 exec，绝不能因为这层包装破坏用户的 CLI。
 */
export function ensureAgentShims(dir: string): void {
  if (process.platform === 'win32') {
    // Windows 需要 .cmd 包装且 where/findstr 的转义易错，未验证前不做（宁可没有，不可写坏）
    return
  }
  try {
    const serverPath = serverScriptPath()
    if (!fs.existsSync(serverPath)) return

    // Claude Code：--mcp-config 接 JSON 文件（不加 --strict-mcp-config，用户自己的 MCP 要保留）
    // 必须写成 --mcp-config=<file>：它声明为可变参数 <configs...>，用空格分隔会把用户自己的
    // 位置参数一并吞掉（claude mcp list → 把 mcp、list 当成配置文件路径，直接报错）
    const cfgFile = path.join(app.getPath('userData'), 'mcp-config.json')
    fs.writeFileSync(
      cfgFile,
      JSON.stringify({
        mcpServers: {
          'eas-term': {
            type: 'stdio',
            command: process.execPath,
            args: [serverPath],
            env: { ELECTRON_RUN_AS_NODE: '1' }
          }
        }
      })
    )

    const sq = (s: string): string => "'" + s.replace(/'/g, `'\\''`) + "'" // 路径可能含空格/引号
    // 剔除本目录用纯 shell 内建（IFS 分割 + 字符串拼接），不调 tr/grep/paste——
    // 这脚本要分发到各种环境里跑，PATH 里连 coreutils 都可能没有，外部依赖越少越稳。
    const realOf = (bin: string): string => `SELF=${sq(dir)}
CLEAN=
OLDIFS=$IFS
IFS=:
for p in $PATH; do
  [ "$p" = "$SELF" ] && continue
  CLEAN="\${CLEAN:+$CLEAN:}$p"
done
IFS=$OLDIFS
REAL=$(PATH="$CLEAN" command -v ${bin} 2>/dev/null)
if [ -z "$REAL" ]; then
  echo "eas-term: 找不到 ${bin}，请先安装" >&2
  exit 127
fi`

    fs.writeFileSync(
      path.join(dir, 'claude'),
      `#!/bin/sh
# Eas-Term: 自动带上画板的 MCP（只在本 app 的终端里生效，不改你的全局配置）
${realOf('claude')}
exec "$REAL" --mcp-config=${sq(cfgFile)} "$@"
`,
      { mode: 0o755 }
    )

    // Codex：用 -c 覆盖配置项（放在子命令前，实测 codex mcp list 能识别，且用户原有 server 保留）
    const cxArgs = [
      `-c mcp_servers.eas-term.command=${sq(JSON.stringify(process.execPath))}`,
      `-c mcp_servers.eas-term.args=${sq(JSON.stringify([serverPath]))}`,
      `-c ${sq('mcp_servers.eas-term.env={ELECTRON_RUN_AS_NODE="1"}')}`
    ].join(' ')
    fs.writeFileSync(
      path.join(dir, 'codex'),
      `#!/bin/sh
# Eas-Term: 自动带上画板的 MCP（只在本 app 的终端里生效，不改你的全局配置）
${realOf('codex')}
exec "$REAL" ${cxArgs} "$@"
`,
      { mode: 0o755 }
    )
    console.log('[mcp] 已装好 claude / codex 包装脚本：' + dir)
  } catch (e) {
    console.error('[mcp] 装包装脚本失败(MCP 将不可用，但不影响 CLI 本身)', e)
  }
}

/** 一次性迁移清理：早期版本会把 eas-term 写进用户的 ~/.claude.json。
 *  现在改走包装脚本了，把当初留下的那条抹掉——只删自己写的这个键，别的一律不碰。 */
function cleanupLegacyGlobalConfig(): void {
  try {
    const cfgFile = path.join(app.getPath('home'), '.claude.json')
    if (!fs.existsSync(cfgFile)) return
    let cfg: Record<string, unknown>
    try {
      cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) as Record<string, unknown>
    } catch {
      return // 解析不了就别动，用户配置比这点清理重要得多
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return
    const servers = cfg.mcpServers as Record<string, { args?: unknown }> | undefined
    const entry = servers?.['eas-term']
    // 只删确认是自己写的那条（args 指向 eas-mcp.mjs），同名但别人写的不动
    if (!entry || !JSON.stringify(entry.args ?? '').includes('eas-mcp.mjs')) return
    delete servers!['eas-term']
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2))
    console.log('[mcp] 已从 ~/.claude.json 移除早期写入的 eas-term（改走包装脚本，不再动全局配置）')
  } catch (e) {
    console.error('[mcp] 清理旧全局配置失败(无害)', e)
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
    cleanupLegacyGlobalConfig()
    console.log('[mcp] bridge listening on 127.0.0.1:' + port)
  })

  app.on('will-quit', () => {
    server?.close()
    server = null
  })
}
