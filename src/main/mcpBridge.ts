// MCP 桥：把画板能力开放给跑在本 app 终端里的 AI（Claude Code / Codex）。
//
// 链路：Claude ──stdio──▸ mcp/eas-mcp.mjs ──HTTP+token──▸ 这里 ──IPC──▸ 渲染进程 store
//
// 安全三道锁：① 只监听 127.0.0.1；② 随机 token，只经 PTY env 注入给本 app 自己起的终端；
// ③ 路径白名单（open_file/open_html 只允许项目目录内），防止把 ~/.ssh 之类渲染出来。
//
// 同一个 server 上还挂着「会话内核」的审批闭环（/agent-approval/request、
// /agent-approval/resolve，见文件下方与 agentChat/approvalRoute.ts）：hook 脚本
// （resources/agent-hooks/eas-pretooluse.mjs，独立 Node 进程）POST request 后阻塞等决定，
// 渲染层 POST resolve 把决定写回来唤醒它。同源复用这里的 127.0.0.1 + token，没有新开端口。
import { app, ipcMain, BrowserWindow } from 'electron'
import { stripDshRegion, DSH_BEGIN } from './legacyDshCleanup'
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { secretsForRun } from './secrets'
import { mainWindow } from './island'
import { approvalIdOf, waitForApproval, resolveApproval } from './agentChat/approvalRoute.ts'

/** 标题栏「MCP 接入」开关在主进程的影子。
 *  渲染层那份只挡得住 /invoke（它是在 onInvoke 回调里查的），
 *  /secret-env 走主进程直通、一步都不进渲染层，所以必须在这边也有一份。
 *  开关文案写的是「关掉后所有工具调用立刻被拒」—— 安全开关撒谎比没有开关更糟。 */
let mcpEnabled = true

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
  // 必须是主窗口，不能随便挑一扇。灵动岛也是一个 BrowserWindow，但它是独立的精简
  // preload，没有注册 mcp:invoke 的监听——挑到它，这次调用只会一直等到下面的超时。
  // 灵动岛的建出条件是「有终端在跑」，也就是本函数最常被调用的时候恰恰最容易挑错。
  const win = mainWindow()
  if (!win) return Promise.resolve({ ok: false, error: '窗口未就绪' })
  const id = seq++
  // 大多数工具是纯 store 操作，15 秒绰绰有余。
  // 但**要等人在界面上点确认**的那几个，几十秒到几分钟都正常 ——
  // 用 15 秒卡它们等于这个功能永远超时。
  //
  // 加一个就要往这个清单里补一条。2026-08-19 team_spawn 就是漏了这条：
  // 端到端第一次验证时清单确实弹出来了，MCP 那侧却在 15 秒后先超时返回，
  // 用户点什么都没意义了。判据是「这个工具会不会阻塞等人点」，不是它有多重要。
  const WAITS_FOR_HUMAN = new Set(['wiki_archive_plan', 'team_spawn'])
  const ms = WAITS_FOR_HUMAN.has(tool) ? 10 * 60 * 1000 : 15000
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(id))
        resolve({
          ok: false,
          error:
            tool === 'wiki_archive_plan'
              ? '用户一直没有确认这份归档计划（已等 10 分钟）。先别动文件，等他回来再说。'
              : tool === 'team_spawn'
                ? '用户一直没有处理那张派活清单（已等 10 分钟）。当成他没同意，按单会话继续做。'
                : '渲染层超时未响应'
        })
    }, ms)
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
function runnerFor(scriptArgs: string[]): { command: string; args: string[]; env?: Record<string, string> } {
  const candidates =
    process.platform === 'win32'
      ? []
      : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return { command: c, args: scriptArgs }
    } catch {
      /* 探测失败就试下一个 */
    }
  }
  return { command: process.execPath, args: scriptArgs, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** 开发时跑的实例**不许改用户的全局 CLI 配置**。
 *
 *  否则每次 `npm run dev` 或者拿 out/ 起一个测试实例，都会把 ~/.claude.json 里的
 *  eas-term 指向开发目录 —— 用户日常在 /Applications 那个版本里用的 MCP
 *  就被悄悄换成了源码树里的那份。改坏了还很难联想到是「开发时顺手起的实例」干的
 *  （2026-08-06 实测撞到：验证功能跑了几次 dev，回头发现全局配置被改了）。
 *
 *  判据用 app.isPackaged：打包版才写。想在开发时也测这条链路，
 *  设 EAS_WRITE_GLOBAL_MCP=1 显式打开。 */
function skipGlobalWrite(): boolean {
  if (app.isPackaged) return false
  if (process.env.EAS_WRITE_GLOBAL_MCP === '1') return false
  console.log('[mcp] 开发实例，跳过写用户全局 CLI 配置（EAS_WRITE_GLOBAL_MCP=1 可强制写）')
  return true
}

/** 笔纵画板 MCP 启动包装器（mcp/bizone-mcp.mjs）。它负责「调用前确保画板在跑」，
 *  真正的工具实现仍然是画板包里那个 mcpServer.js。 */
function bizoneWrapperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'bizone-mcp.mjs')
    : path.join(app.getAppPath(), 'mcp', 'bizone-mcp.mjs')
}

/** 笔纵画板的 MCP server 路径。**跑不起来就返回 null，一个字都不往用户配置里写。**
 *
 *  为什么由我们来写：笔纵那边没有自动配置用户 CLI 的机制，而两个 app 都是同一个人的，
 *  用户装了画板却要手工去 ~/.claude.json 里加一条才能让 agent 生图 —— 那道门槛
 *  足以让绝大多数人止步。
 *
 *  路径能这么推是因为笔纵**没打 asar**（build.asar 未开），资源直接躺在
 *  Contents/Resources/app/ 下。哪天它改成 asar，这里要跟着改 —— 所以下面
 *  existsSync 不通过时是静默返回 null，不会写一条指向空文件的坏配置。
 *
 *  **光有文件不够，还要它的依赖在。** 2026-08-11 实测：1.21.18 那个包
 *  Contents/Resources/app/ 底下压根没有 node_modules（package.json 的 dependencies
 *  也是空的），直接跑那个 mcpServer.js 会 `ERR_MODULE_NOT_FOUND: Cannot find package
 *  '@modelcontextprotocol/sdk'`。而老代码只查 mcpServer.js 在不在 —— 于是给每个装了
 *  旧版画板的用户都写了一条**必然失败**的配置，用户看到的只有一句「MCP 连接失败」，
 *  根本联想不到是画板该更新了。宁可不配：不配至少还能从界面上看出「没接上」。 */
function bizoneServerPath(): string | null {
  // Windows 上笔纵装在哪还没核实过，先只做 macOS —— 宁可不配，也不写个猜的路径
  if (process.platform !== 'darwin') return null
  const appRoot = '/Applications/笔纵画板.app/Contents/Resources/app'
  const p = path.join(appRoot, 'electron', 'mcpServer.js')
  try {
    if (!fs.existsSync(p)) return null
    // 只查这一个包：mcpServer.js 的外部依赖实测就只有它（其余全是 node 内置模块），
    // 逐个校验整棵依赖树既慢又会随画板版本漂移。
    if (!fs.existsSync(path.join(appRoot, 'node_modules', '@modelcontextprotocol', 'sdk'))) {
      console.warn('[mcp] 画板版本太旧（包里没带 MCP 依赖），跳过配置 bizone-canvas')
      return null
    }
    return p
  } catch {
    return null
  }
}

interface McpRun {
  command: string
  args: string[]
  env?: Record<string, string>
}

/** 笔纵那条的运行方式。**按画板官方集成文档来**（taptv 的 docs/MCP_INTEGRATION.md，
 *  本仓库 docs/笔纵画板-MCP集成.md 有存档）：用画板自带的 Electron 以 node 模式跑。
 *
 *  为什么不沿用 runnerFor 那套「优先系统 node」：
 *   · 分发用户机器上不一定装了 node；Intel Mac 的 Homebrew 也不在 /opt/homebrew
 *   · 就算装了，版本可能太老 —— 画板的 mcpServer.js 和我们的包装器都是 ESM + 顶层 await
 *  画板自带的 Electron 内置 node v22，装了画板就一定有，是这条链路上最稳的运行时。
 *
 *  代价是这条配置绑死画板的安装位置：把画板改名或移出 /Applications 就会断。
 *  这一点文档里也写了，接受 —— 那种情况下 bizoneServerPath() 本来也会返回 null。 */
function bizoneRunner(server: string): McpRun {
  return {
    command: '/Applications/笔纵画板.app/Contents/MacOS/笔纵画板',
    // 中间夹一层我们的包装器：画板没开着时它先把画板拉起来再交棒。
    // 画板那个 server 自己不会拉（实测：整个文件里没有 spawn / open -a），
    // 而它的每一个工具都要打到画板本体的 HTTP 接口上。
    args: [bizoneWrapperPath(), server],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

/** 这一轮要写进用户 CLI 的所有 MCP 条目。eas-term 恒有，笔纵按装没装决定。
 *  直接给出完整运行方式 —— 两条的运行时不一样，不能共用一个 runnerFor。 */
function mcpEntries(serverPath: string): { name: string; run: McpRun }[] {
  const list: { name: string; run: McpRun }[] = [
    { name: 'eas-term', run: runnerFor([serverPath]) }
  ]
  const bz = bizoneServerPath()
  if (bz) list.push({ name: 'bizone-canvas', run: bizoneRunner(bz) })
  return list
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
    if (skipGlobalWrite()) return
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
    let dirty = false
    for (const { name, run: r } of mcpEntries(serverPath)) {
      const desired = { type: 'stdio', command: r.command, args: r.args, ...(r.env ? { env: r.env } : {}) }
      if (JSON.stringify(servers[name]) === JSON.stringify(desired)) continue
      servers[name] = desired
      dirty = true
    }
    if (!dirty) return // 全都没变就不写盘
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
/** 【历史残留清理】0.4.27–0.4.30 往 DeepSeek Harness 每个 profile 的
 *  cordis.patch.yml 里写过 MCP 配置。支持已移除，这两个函数只为找出并清掉它们。
 *  跟随 `$DSH_HOME`（用户改过的话，东西就在他改的位置）。 */
const legacyDshProfilesDir = (): string =>
  path.join(process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh'), 'profiles')

function legacyDshProfiles(): string[] {
  try {
    return fs
      .readdirSync(legacyDshProfilesDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'node_modules')
      .map((d) => path.join(legacyDshProfilesDir(), d.name))
      .filter((d) => fs.existsSync(path.join(d, 'cordis.patch.yml')))
  } catch {
    return []
  }
}

/** 清掉 0.4.27–0.4.30 写进 DeepSeek Harness 的 MCP 配置。安装和卸载都会调 ——
 *  装过的人升级到这一版就自动清掉，不必为了清残留专门去点一次卸载。
 *  清干净之后这个函数连同 legacyDshCleanup.ts 一起删。 */
function purgeLegacyDshMcp(): void {
  // 0.4.27–0.4.30 写进去的，每个 profile 的 patch 层各摘一次围栏段。
  // **围栏外一个字不碰**，全空之后把 `[]` 还回去（空文件不是合法的 patch 层）
  for (const dir of legacyDshProfiles()) {
    const f = path.join(dir, 'cordis.patch.yml')
    try {
      const raw = fs.readFileSync(f, 'utf8')
      if (!raw.includes(DSH_BEGIN)) continue
      const next = stripDshRegion(raw)
      if (next === raw) continue
      try {
        fs.copyFileSync(f, f + '.eas-backup')
      } catch {
        /* 备份失败不阻断 */
      }
      fs.writeFileSync(f, next)
      console.log(`[mcp] 已清掉 dsh 的 MCP 残留（${f}）`)
    } catch (e) {
      console.error('[mcp] 清 dsh 残留失败', e)
    }
  }
}


function writeCodexConfig(serverPath: string): void {
  for (const { name, run } of mcpEntries(serverPath)) writeCodexSection(name, run)
}

/** 写 ~/.codex/config.toml 里的一段 [mcp_servers.<name>]。逐段处理而不是一次写完：
 *  这个文件是按行扫描改的（没有 TOML 库），一段一段来最不容易碰坏别人的内容。 */
function writeCodexSection(name: string, r: McpRun): void {
  try {
    if (skipGlobalWrite()) return
    const dir = path.join(app.getPath('home'), '.codex')
    const cfgFile = path.join(dir, 'config.toml')
    if (!fs.existsSync(dir)) return // 没装/没用过 Codex 就别给人家建目录

    const q = (v: string): string => JSON.stringify(v) // TOML 基本字符串的转义规则与 JSON 兼容
    const HEAD = `[mcp_servers.${name}]`
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
    console.log(`[mcp] 已配置 Codex 的 ${name}（~/.codex/config.toml）`)
  } catch (e) {
    console.error('[mcp] 写 Codex 配置失败(可手动配置)', e)
  }
}

// ── 状态与移除：MCP 条目是**静默**写进用户全局配置的（画板工具不配它就完全不能用），
// 所以必须在界面上如实告知动了哪个文件，并且给一键移除。
// 静默写入 + 不可见 + 不可撤 三者同时成立才是问题，只要后两条补上就是可接受的。

const claudeCfg = (): string => path.join(app.getPath('home'), '.claude.json')
const codexCfg = (): string => path.join(app.getPath('home'), '.codex', 'config.toml')
/** 我们会写进用户配置的所有 MCP 名字。状态与移除都按这份清单来 ——
 *  漏一个，用户点「移除」就只清掉一半，剩下的成了删不掉的残留。 */
const MANAGED = ['eas-term', 'bizone-canvas'] as const
const codexHead = (name: string): string => `[mcp_servers.${name}]`

export function mcpConfigStatus(): { claude: boolean; codex: boolean; files: string[] } {
  const files: string[] = []
  let claude = false
  let codex = false
  try {
    const cfg = JSON.parse(fs.readFileSync(claudeCfg(), 'utf8')) as Record<string, unknown>
    const servers = cfg.mcpServers as Record<string, unknown> | undefined
    claude = MANAGED.some((n) => !!servers?.[n])
    if (claude) files.push(claudeCfg())
  } catch {
    /* 没装或读不到 */
  }
  try {
    const lines = fs.readFileSync(codexCfg(), 'utf8').split('\n')
    codex = MANAGED.some((n) => lines.some((l) => l.trim() === codexHead(n)))
    if (codex) files.push(codexCfg())
  } catch {
    /* 没装或读不到 */
  }
  return { claude, codex, files }
}

/** 移除我们写进去的那条 MCP 条目。用户自己的配置一个字不动。 */
export function removeMcpConfig(): void {
  // Claude：解析失败就别写——宁可不删也不能把用户整份配置弄坏
  try {
    const f = claudeCfg()
    const cfg = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>
    const servers = cfg.mcpServers as Record<string, unknown> | undefined
    const hit = servers ? MANAGED.filter((n) => n in servers) : []
    if (servers && hit.length) {
      for (const n of hit) delete servers[n]
      try {
        fs.copyFileSync(f, f + '.eas-backup')
      } catch {
        /* 备份失败不阻断 */
      }
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2))
    }
  } catch {
    /* 没有就算了 */
  }
  // Codex：同写入时的逐行做法，只摘自己那一段（不解析整个 TOML，免得丢注释和格式）
  try {
    const f = codexCfg()
    let lines = fs.readFileSync(f, 'utf8').split('\n')
    let removed = false
    // 先在内存里把每一段都摘掉，最后统一落盘一次 —— 逐段写盘的话，
    // 备份文件会被后一段的写入覆盖成「已经删了一半」的中间态，回滚就不完整了
    for (const name of MANAGED) {
      const at = lines.findIndex((l) => l.trim() === codexHead(name))
      if (at < 0) continue
      let end = at + 1
      while (end < lines.length && !lines[end].trimEnd().startsWith('[')) end++
      // 段尾的空行/注释退回去——注释惯例属于下一个 table，吃掉等于删用户的注释
      while (end > at + 1) {
        const prev = lines[end - 1].trim()
        if (prev === '' || prev.startsWith('#')) end--
        else break
      }
      lines = [...lines.slice(0, at), ...lines.slice(end)]
      removed = true
    }
    if (removed) {
      try {
        fs.copyFileSync(f, f + '.eas-backup')
      } catch {
        /* 备份失败不阻断 */
      }
      fs.writeFileSync(f, lines.join('\n').replace(/\n{3,}/g, '\n\n'))
    }
  } catch {
    /* 没有就算了 */
  }

  purgeLegacyDshMcp()
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
  // 清掉 0.4.27–0.4.30 写进 dsh 的 MCP 配置。**另一半在 agentRules 的
  // purgeLegacyDsh**（AGENTS.md 常驻区 + skill 目录），由 index.ts 在启动时调 ——
  // 不在这里一起调是因为 agentRules 已经 import 了本模块，反向再引就成环。
  // 只清一半就是「删不掉的残留」，两处都要跑。
  purgeLegacyDshMcp()
}

export function registerMcpBridge(): void {
  ipcMain.handle('mcp:removeConfig', () => removeMcpConfig())
  // 渲染层的开关同步一份过来，好让 /secret-env 也能被它关掉
  ipcMain.on('mcp:setEnabled', (_e, v: boolean) => {
    mcpEnabled = v !== false
  })

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

      // eas-secret 包装命令取值。**这是明文离开主进程的第二条路**（第一条是 PTY env 注入），
      // 所以它不走 invokeRenderer —— 值一步都不进渲染层，直接主进程算完回给本机 shim。
      //
      // 门比注入还紧两档：
      //   · 要解锁态
      //   · 认 x-eas-secret-token（每个 PTY 一张，spawn 时发），据此判断这个终端被授权哪几组。
      //     **不能只认上面那个全局 token** —— 它每个终端都一样、还明文落在 mcp-endpoint.json 里，
      //     拿它当门等于没门：一个零密钥终端里的 npm postinstall 就能拿走整柜。
      if (req.method === 'POST' && req.url === '/secret-env') {
        const raw = await readBody(req)
        const sel = JSON.parse(raw || '{}') as { group?: string; vars?: string[] }
        const r = secretsForRun(sel, {
          secretToken: String(req.headers['x-eas-secret-token'] ?? ''),
          mcpEnabled
        })
        return send(r.ok ? 200 : 400, r)
      }

      // statusline 回传：真实的订阅额度百分比与「和 /context 一致」的上下文占用，
      // **只在 statusline 的 stdin 里**（2026-08-18 实测：headless 事件流里没有
      // rate_limits / context_window）。转发脚本见 resources/agent-hooks/eas-statusline.mjs。
      //
      // 收到就原样广播给渲染层 —— 这里不做任何解释或换算，那是渲染层的事。
      // 额度是**账号级**的，不属于某个会话，所以走全窗口广播而不是按 sessionId 定向。
      if (req.method === 'POST' && req.url === '/statusline') {
        const raw = await readBody(req)
        try {
          const j = JSON.parse(raw || '{}') as unknown
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('statusline:data', j)
          }
        } catch {
          /* 坏 JSON 忽略 —— 状态栏每次刷新都发，偶发一次坏包不值得报错 */
        }
        return send(200, { ok: true })
      }

      // 审批闭环的两个端点（会话内核 Task 7）：hook 脚本（外部 Node 进程，见
      // resources/agent-hooks/eas-pretooluse.mjs）POST /agent-approval/request 后**阻塞**
      // 等这里的响应——Claude Code 会等 hook 进程退出才继续，这正是审批卡片成立的前提。
      // 渲染层日后通过 /agent-approval/resolve 把人工决定写回来，把上面的等待唤醒。
      // 挂起/超时/归一化的实际逻辑都在 approvalRoute.ts 里（可单测的纯部分已单测），
      // 这里只做「读 body → 调用 → 回 HTTP」的胶水，与 /secret-env 那段是同一个套路。
      //
      // 完整 payload（不只是 approvalId）原样传给 waitForApproval——它需要 tool_name/
      // tool_input/cwd 这些字段，通过 approvalRoute.ts 的 onApprovalRequest() 广播给
      // 订阅者（Task 8 的 session.ts），拼成审批卡片要显示的内容。这里不解构、不裁剪，
      // 只做 approvalIdOf 这一次早退校验（校验用的是同一份 payload，不影响后面的转发）。
      if (req.method === 'POST' && req.url === '/agent-approval/request') {
        const raw = await readBody(req)
        let payload: unknown
        try {
          payload = JSON.parse(raw || '{}')
        } catch {
          return send(400, { decision: 'deny', reason: 'hook 请求体解析失败' })
        }
        // 拿不到 approvalId 就没法登记等待者，直接兜底 deny——不能悬在这里不回应，
        // 那会让 Claude Code 的 hook 进程无限期卡住。（waitForApproval 内部也会做这个
        // 检查，这里提前做只是为了能回一个 400 而不是 200，属于 HTTP 层的状态码判断。）
        if (!approvalIdOf(payload)) return send(400, { decision: 'deny', reason: '请求缺少 tool_use_id' })
        const decision = await waitForApproval(payload)
        return send(200, decision)
      }

      if (req.method === 'POST' && req.url === '/agent-approval/resolve') {
        const raw = await readBody(req)
        let body: { approvalId?: unknown; decision?: unknown; reason?: unknown }
        try {
          body = JSON.parse(raw || '{}') as typeof body
        } catch {
          return send(400, { ok: false, error: '请求体解析失败' })
        }
        // 命中已登记的等待者才 true；已经超时/已经回过一次/根本没这个请求都返回 false，
        // 不抛——resolveApproval 内部已经把 decision 兜底成 allow/deny，不会把非法值放行。
        const ok = resolveApproval(body.approvalId, body.decision, body.reason)
        return send(ok ? 200 : 404, { ok })
      }

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
