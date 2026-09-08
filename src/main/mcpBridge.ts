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
import { findPlugin } from './plugins'
import { stripDshRegion, DSH_BEGIN } from './legacyDshCleanup'
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { secretsForRun } from './secrets'
import { mainWindow } from './island'
import { approvalIdOf, waitForApproval, resolveApproval } from './agentChat/approvalRoute.ts'
import { shouldAutoInstall, optOutPayload } from './mcpOptOut'
import { ingestStatusline } from './quotaStore'
import { builtinCapabilityHost, pluginBye, pluginHeartbeat, pluginRpcFromShim } from './pluginHost.ts'
import { writeCapabilitySnapshot } from './capabilitySnapshot.ts'
import { selectedNativeServers, capabilityMcpConfig } from './selectedCapabilityServers.ts'
import { assembleCapabilityServers, type SessionMcpServer } from '../shared/builtinCapabilities.ts'
import { CapabilitySessions, type CapabilityLease } from './capabilitySessions.ts'
import { capabilityBundleRoot, capabilityGuidanceDir } from './capabilityBundlePaths.ts'
import { CapabilityPreferenceStore, readCapabilityBundle } from './capabilityPreferences.ts'
import { buildCapabilityGuidance } from './capabilityGuidance.ts'
import type { CapabilityBundleStatus, CapabilityModule } from '../shared/builtinCapabilities.ts'
import { nodeRunner } from './nodeBin.ts'
import { buildPtyCapabilityCommand, capabilityInvocationCwd, type PtyCapabilityInvocation } from './capabilityPtyCommand.ts'
import { createBizoneRuntime } from './bizoneRuntime.ts'
import { discoverBizoneWindowsInstallation } from './bizoneWindowsDiscovery.ts'
import { createBizoneHosted } from './bizoneHosted.ts'
import { CapabilityMigrationService } from './capabilityMigrationService.ts'
import { expectedCodexRegion } from './agentRules.ts'
import { guardDir } from './fsGuard.ts'
import { createOmpCapabilityPlugin } from './ompCapabilityPlugin.ts'

/** 标题栏「MCP 接入」开关在主进程的影子。
 *  渲染层那份只挡得住 /invoke（它是在 onInvoke 回调里查的），
 *  /secret-env 走主进程直通、一步都不进渲染层，所以必须在这边也有一份。
 *  开关文案写的是「关掉后所有工具调用立刻被拒」—— 安全开关撒谎比没有开关更糟。 */
let mcpEnabled = true

interface Ctx {
  /** 这个会话是团队派生的，值是它的角色名。**只有成员有**，主 agent 一律没有 */
  teamRole?: string
  /** 调用方所在终端的 ptyId：渲染层据此反查「我在哪个 Frame / 哪个节点」
   *  （终端是先创建 pty、之后才挂到 Frame 节点上的，spawn 时还不知道 frameId，所以注入 ptyId 更可靠） */
  ptyId?: string
  agentSessionId?: string
  agentLeafId?: string
  /** Existing canvas agent node; independent of split-pane leaf identity. */
  agentNodeId?: string
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
const capabilitySessions = new CapabilitySessions(crypto.randomUUID(), crypto.randomUUID())
const capabilityLeases = new Map<string, { lease: CapabilityLease; context: string }>()

const bizoneRuntime = createBizoneRuntime({ ...(process.platform === 'win32' ? {
  discover: () => discoverBizoneWindowsInstallation(url => app.getApplicationInfoForProtocol(url))
} : {}) })
let capabilityPreferenceStore: CapabilityPreferenceStore | undefined
let migrationService: CapabilityMigrationService | undefined
function capabilityMigrationService(): CapabilityMigrationService {
  migrationService ??= new CapabilityMigrationService({
    appOwnedRoot: app.getPath('userData'), homeDirectory: app.getPath('home'),
    expectedRegion: expectedCodexRegion,
    isEnabled: () => mcpEnabled && capabilityPreferences().preferences.workbench && capabilityPreferences().preferences.guidance,
    isTrustedProject: project => guardDir(project).ok
  })
  return migrationService
}
/** Trusted main callers pass an app-issued identity; target paths come from the manifest. */
export function rollbackBuiltinCapabilityMigration(migrationId: string) {
  return capabilityMigrationService().rollback(migrationId)
}
const bundlePaths = () => ({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
function capabilityPreferences() {
  capabilityPreferenceStore ??= new CapabilityPreferenceStore(app.getPath('userData'), { legacyMcpOptOut: !shouldAutoInstall(readOptOut()) })
  return capabilityPreferenceStore.read()
}
export function capabilityGuidanceEnabled(): boolean { return capabilityPreferences().preferences.guidance }
export function sessionCapabilityGuidance(): string {
  const bundle = readCapabilityBundle(path.join(capabilityBundleRoot(bundlePaths()), 'bundle.json'))
  const preferences = capabilityPreferences().preferences
  return buildCapabilityGuidance({ preferences, directory: capabilityGuidanceDir(bundlePaths()), version: bundle.version, bizoneInstalled: !!bizoneRuntime.installed() })
}
function capabilityStatus(): CapabilityBundleStatus {
  const bundle = readCapabilityBundle(path.join(capabilityBundleRoot(bundlePaths()), 'bundle.json'))
  const preferences = capabilityPreferences()
  return { id: bundle.id, version: bundle.version, displayName: bundle.displayName,
    ...(preferences.error ? { error: '能力设置无法读取，已停止启用；请保留配置文件以便恢复。' } : {}),
    modules: {
      workbench: { enabled: preferences.preferences.workbench, dependency: 'available', ...builtinCapabilityHost.status('workbench') },
      bizone: { enabled: preferences.preferences.bizone, dependency: bizoneRuntime.installed() ? 'available' : 'missing', ...builtinCapabilityHost.status('bizone') },
      guidance: { enabled: preferences.preferences.guidance, dependency: 'available', session: 'not-requested' }
    }
  }
}

/** Called only by a managed session owner, never an IPC payload or an external MCP caller. */
export function capabilitySessionEnv(sessionKey: string, ctx: Ctx): Record<string, string> {
  if (!port || !token) throw new Error('内置能力网关尚未就绪')
  // Each owned process gets a fresh generation; a retired process cannot keep using its lease.
  revokeCapabilitySession(sessionKey)
  const entry = { lease: capabilitySessions.issue(ctx), context: JSON.stringify(ctx) }
  capabilityLeases.set(sessionKey, entry)
  return { EAS_TERM_PORT: String(port), EAS_CAPABILITY_LEASE: JSON.stringify(entry.lease) }
}

/** One parent belongs to the PTY shell; each CLI launch exchanges it for a child. */
export function capabilityPtyEnv(ptyId: string, project: string): Record<string, string> {
  if (!port || !token) throw new Error('内置能力网关尚未就绪')
  const key = 'pty:' + ptyId
  revokeCapabilitySession(key)
  const context = { ptyId, project }
  const lease = capabilitySessions.issue(context, 'launcher')
  capabilityLeases.set(key, { lease, context: JSON.stringify(context) })
  return { EAS_TERM_PORT: String(port), EAS_CAPABILITY_PARENT: JSON.stringify(lease) }
}

export function revokeCapabilitySession(sessionKey: string): void {
  const entry = capabilityLeases.get(sessionKey)
  if (!entry) return
  for (const id of capabilitySessions.revoke(entry.lease.id)) builtinCapabilityHost.releaseSession(id)
  capabilityLeases.delete(sessionKey)
}
const pending = new Map<number, (r: InvokeResult) => void>()

export function mcpEnv(ctx: Ctx): Record<string, string> {
  if (!port || !token) return {}
  const env: Record<string, string> = {
    EAS_TERM_PORT: String(port),
    EAS_TERM_TOKEN: token
  }
  if (ctx.ptyId) env.EAS_PTY_ID = ctx.ptyId
  if (ctx.project) env.EAS_PROJECT = ctx.project
  // **团队派生的会话自报身份。** 在此之前只能靠「这个 cwd 下有没有活的 team 会话」
  // 反推，那是个会误伤的猜测：主 agent 自己开在同一个项目里时也会被当成成员。
  // 对 team_spawn 那道拦截无所谓（一批在跑时限流闸本来就会拒），
  // 但 team_send 恰恰要在「有 agent 在跑」时用 —— 猜错就是 100% 挡住合法调用。
  // 2026-08-19 隔离环境实测撞到：主 agent 调 team_send 被当成成员拒了。
  if (ctx.teamRole) env.EAS_TEAM_ROLE = ctx.teamRole
  return env
}

// 把一次工具调用转给渲染进程执行（store action 都在那边），等它回结果
export function invokeRenderer(tool: string, args: unknown, ctx: Ctx): Promise<InvokeResult> {
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
  //
  // ── 这条链路一共有**三层**超时，不是两层 ──────────────────────────
  // 这段注释原来只提渲染层和主进程，漏了最外面那层，而它恰恰是最短的：
  //
  //   ① MCP shim（mcp/eas-mcp.mjs 的 fetch）  ← 最外，也最容易被忘
  //   ② 主进程（这里）
  //   ③ 渲染层（features/team/batchRequest.ts 的 WAIT_MS）
  //
  // **正确的关系是 ①  >  ②  >  ③** —— 让最靠里的那层先判超时，
  // 用户才能收到一句写清楚的话，而不是一个 fetch 报错。
  // 三处任何一个数字动了，都要回来核对这个不等式。
  // （2026-08-19：shim 那层没设超时，吃 undici 默认值，成了实际最短的一道闸，
  //   于是「清单能等 10 分钟」是假的。由一个 cross-checker agent 实测抓到。）
  // 名字从 WAITS_FOR_HUMAN 改成 LONG_WAITS：team_status 的等待模式**不是等人**，
  // 是挂着等某个子 agent 交活（渲染层 8 分钟）。判据统一成「这个工具会不会阻塞着等」，
  // 不管等的是人还是别的进程 —— 按「等人」命名会让下一个加长等待工具的人以为不适用。
  // merge_preflight / repo_impact 不等人也不等进程，是**慢**：merge-tree 给了 30s、
  // analyzeProject 大仓库要几秒到几十秒，都超过普通的 15s 闸。名单与 mcp/eas-mcp.mjs 同改。
  const LONG_WAITS = new Set(['wiki_archive_plan', 'team_spawn', 'team_status', 'merge_preflight', 'repo_impact'])
  const ms = LONG_WAITS.has(tool) ? 10 * 60 * 1000 : 15000
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
/** 自家插件在会话里的转发 shim（设计稿 2026-09-05 决定 #2），和 eas-mcp.mjs 同目录分发 */
function pluginShimPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'eas-plugin-shim.mjs')
    : path.join(app.getAppPath(), 'mcp', 'eas-plugin-shim.mjs')
}

/** MCP server 的运行方式：优先用系统 node（纯脚本零依赖，进程轻）；
 *  找不到就用 app 自带的 Electron 以 node 模式跑，保证任何机器上都能启动。
 *  注意主进程在 GUI 启动时 PATH 很贫瘠（/usr/bin:/bin:...），所以是探路径而不是 which。 */
function runnerFor(scriptArgs: string[]): { command: string; args: string[]; env?: Record<string, string> } {
  // 规则本体在 nodeBin.ts（插件宿主也用它，两边一致）
  return nodeRunner(scriptArgs, { electron: process.execPath })
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
  // 记下这个决定，让它活过重启 —— 否则下次启动 setupAgents 又把配置写回去，
  // 用户会觉得「我明明关了，它自己又装上了」。
  writeOptOut(true)
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

/** 用户「我不要 MCP 接入」这个决定存在哪。**必须落盘** —— 它要活过重启，
 *  否则界面上那颗「移除」只管当次，下次启动 setupAgents 又写回去了。 */
const optOutFile = (): string => path.join(app.getPath('userData'), 'mcp-optout.json')

function readOptOut(): string | null {
  try {
    return fs.readFileSync(optOutFile(), 'utf8')
  } catch {
    return null // 文件不存在 = 从没拒绝过，这是绝大多数用户的情况
  }
}

function writeOptOut(optedOut: boolean): void {
  try {
    fs.writeFileSync(optOutFile(), optOutPayload(optedOut, Date.now()), { mode: 0o600 })
  } catch (e) {
    // 写不进去只影响「这个决定能不能活过重启」，不该让移除/安装本身失败
    console.error('[mcp] 记录 opt-out 状态失败', e)
  }
}

/** 用户有没有明确关掉过。给 footprint 面板判断该显示「安装」还是「移除」。 */
export function mcpOptedOut(): boolean {
  return !shouldAutoInstall(readOptOut())
}

/** Eas business plugins keep the shared host shim. Native selected plugins are
 * normalized separately and never gain the global gateway token. */
export function easPluginMcpServer(
  pluginId?: string
): { name: string; command: string; args: string[]; env: Record<string, string> } | null {
  if (!pluginId) return null
  const plug = findPlugin(pluginId)
  if (plug?.cli !== 'eas' || !plug.mcp) return null
  const r = runnerFor([pluginShimPath()])
  return { name: plug.name, command: r.command, args: r.args, env: { ...(r.env ?? {}), EAS_PLUGIN: plug.name } }
}

/** Explicit base + selected business servers. Native configuration values stay in
 * an app-owned 0600 snapshot instead of Codex command-line arguments. */
export function sessionMcpServers(pluginId?: string): SessionMcpServer[] {
  const preferences = capabilityPreferences().preferences
  const envVars = ['EAS_TERM_PORT', 'EAS_TERM_TOKEN', 'EAS_PTY_ID', 'EAS_PROJECT', 'EAS_TEAM_ROLE', 'EAS_CAPABILITY_LEASE']
  const scoped = runnerFor([path.join(path.dirname(serverScriptPath()), 'eas-capability-shim.mjs')])
  const base = (['workbench', 'bizone'] as const).map(module => ({
    enabled: preferences[module] && (module !== 'bizone' || process.platform === 'win32' || !!bizoneRuntime.installed()),
    server: { name: module === 'workbench' ? 'eas-term' : 'bizone-canvas', ...scoped,
      env: { ...scoped.env, EAS_CAPABILITY_MODULE: module },
      envVars: ['EAS_TERM_PORT', 'EAS_CAPABILITY_LEASE'] }
  }))
  const plugin = pluginId ? findPlugin(pluginId) : undefined
  if (pluginId && !plugin) throw new Error('所选业务插件不可用，请重新选择')
  const selected = easPluginMcpServer(pluginId)
  const native = plugin && !selected ? selectedNativeServers(plugin) : []
  // Validate collisions before persisting a selected plugin snapshot.
  assembleCapabilityServers(base, selected ? [{ ...selected, envVars }] : native)
  const snapshotPath = native.length ? writeCapabilitySnapshot(path.join(app.getPath('userData'), 'capability-snapshots'),
    `selected:${plugin!.id}`, capabilityMcpConfig(native)) : undefined
  const protectedNative = native.map(server => {
    if (server.nativeRemote) return server
    const runner = runnerFor([path.join(path.dirname(serverScriptPath()), 'eas-selected-mcp-launcher.mjs'), snapshotPath!, server.name])
    return { name: server.name, ...runner, ...(server.envVars ? { envVars: server.envVars } : {}) }
  })
  return assembleCapabilityServers(base, selected ? [{ ...selected, envVars }] : protectedNative)
}

export function agentMcpConfigPath(pluginId?: string, sessionKey = 'preview', snapshot?: readonly SessionMcpServer[]): string {
  if (!fs.existsSync(serverScriptPath())) throw new Error('内置 MCP 执行文件缺失，无法启动能力会话')
  try {
    return writeCapabilitySnapshot(path.join(app.getPath('userData'), 'capability-snapshots'), sessionKey,
      capabilityMcpConfig(snapshot ?? sessionMcpServers(pluginId)))
  } catch {
    // Never fall back to a strict Claude/ACP session with a silently empty tool list.
    throw new Error('会话 MCP 配置无法装配或保存；请检查所选插件和应用数据目录')
  }
}

/**
 * @param force 用户刚在界面上点了「安装」—— 这时无视 opt-out 标记（他正在收回那个决定）
 */
function setupAgents(force = false): void {
  // Builtin capabilities are injected per managed invocation. Startup must not
  // replace global server tables (which may contain user deny/allow lists).
  // Legacy removal is a separate, backed-up migration after the new link passes.
  if (!force) return
  const serverPath = serverScriptPath()
  if (!fs.existsSync(serverPath)) return
  // **用户明确关过就不自动装回来。** 判定在 mcpOptOut.ts，那里写了为什么任何异常
  // 都倒向「装」：不装的后果是画板工具整个不可用，误装只是让他再点一次移除。
  if (!force && !shouldAutoInstall(readOptOut())) {
    console.log('[mcp] 用户关过 MCP 接入，跳过自动配置（在「扩展能力」面板里可以重新安装）')
    return
  }
  removeLegacyAgentShims()
  writeClaudeConfig(serverPath)
  writeCodexConfig(serverPath)
  // 清掉 0.4.27–0.4.30 写进 dsh 的 MCP 配置。**另一半在 agentRules 的
  // purgeLegacyDsh**（AGENTS.md 常驻区 + skill 目录），由 index.ts 在启动时调 ——
  // 不在这里一起调是因为 agentRules 已经 import 了本模块，反向再引就成环。
  // 只清一半就是「删不掉的残留」，两处都要跑。
  purgeLegacyDshMcp()
}

/** 界面上点「安装」：收回之前的拒绝，并立刻把配置写回去 ——
 *  不能只清标记等下次启动，那样用户点完什么都没发生。 */
export function installMcpConfig(): void {
  writeOptOut(false)
  setupAgents(true)
}

export function registerMcpBridge(): void {
  void bizoneRuntime.refreshInstallation()
  ipcMain.handle('capabilities:status', async () => { await bizoneRuntime.refreshInstallation(); return capabilityStatus() })
  ipcMain.handle('capabilities:setModule', (_event, module: CapabilityModule, enabled: boolean) => {
    capabilityPreferences()
    capabilityPreferenceStore!.set(module, enabled)
    return capabilityStatus()
  })
  ipcMain.handle('mcp:removeConfig', () => removeMcpConfig())
  ipcMain.handle('mcp:installConfig', () => installMcpConfig())
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

  builtinCapabilityHost.register('bizone', () => createBizoneHosted({ appOwnedDataDir: app.getPath('userData'), version: app.getVersion(), runtime: bizoneRuntime }))
  builtinCapabilityHost.register('workbench', () => {
    const tools = JSON.parse(fs.readFileSync(path.join(path.dirname(serverScriptPath()), 'workbench-tools.json'), 'utf8'))
    return {
      kind: 'builtin',
      tools: async () => tools,
      call: async (name, args, ctx) => {
        const result = await invokeRenderer(name, args, ctx)
        return { content: [{ type: 'text', text: JSON.stringify(result.ok ? result.data ?? null : result.error) }], ...(!result.ok ? { isError: true } : {}) }
      },
      close() {}
    }
  })
  app.on('before-quit', () => {
    capabilitySessions.revokeAll()
    capabilityLeases.clear()
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
      if (req.method === 'POST' && (req.url === '/capability/launch' || req.url === '/capability/launch/close')) {
        const body = JSON.parse(await readBody(req)) as PtyCapabilityInvocation & { parent: CapabilityLease; leaseId?: string }
        try { capabilitySessions.authenticateLauncher(body.parent) }
        catch { return send(401, { ok: false, error: '终端能力授权无效或已撤销' }) }
        if (req.url === '/capability/launch/close') {
          for (const id of capabilitySessions.revokeChild(body.parent, String(body.leaseId ?? ''))) builtinCapabilityHost.releaseSession(id)
          return send(200, { ok: true, result: {} })
        }
        if (!['claude', 'codex', 'omp'].includes(body.kind) || typeof body.binary !== 'string' || !path.isAbsolute(body.binary) ||
            typeof body.cwd !== 'string' || !path.isAbsolute(body.cwd) || !Array.isArray(body.args) || body.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
          return send(400, { ok: false, error: 'CLI 启动参数无效' })
        }
        const cwd = capabilityInvocationCwd(body)
        if (!fs.statSync(cwd).isDirectory() || !fs.statSync(body.binary).isFile()) return send(400, { ok: false, error: 'CLI 或工作目录不可用' })
        // issueChild authenticates after reading the entire request body.
        const child = capabilitySessions.issueChild(body.parent, { project: cwd })
        try {
          const servers = sessionMcpServers()
          const configPath = agentMcpConfigPath(undefined, child.id) ?? writeCapabilitySnapshot(path.join(app.getPath('userData'), 'capability-snapshots'), child.id, {})
          const host = { isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, electron: process.execPath }
          const preferences = capabilityPreferences().preferences
          const ompExtension = body.kind === 'omp' ? createOmpCapabilityPlugin({
            appOwnedRoot: app.getPath('userData'),
            runner: runnerFor([path.join(path.dirname(serverScriptPath()), 'eas-capability-shim.mjs')]),
            enabled: { workbench: preferences.workbench, bizone: preferences.bizone },
            version: '1.0.0'
          })?.root : undefined
          const launch = buildPtyCapabilityCommand(body, { servers, configPath, guidance: sessionCapabilityGuidance(), ompExtension }, host)
          return send(200, { ok: true, result: { leaseId: child.id, command: launch.command, args: launch.args,
            env: { ...launch.env, EAS_TERM_PORT: String(port), EAS_CAPABILITY_LEASE: JSON.stringify(child) } } })
        } catch (error) {
          for (const id of capabilitySessions.revoke(child.id)) builtinCapabilityHost.releaseSession(id)
          throw error
        }
      }
      // Scoped route has its own authority. A legacy gateway token cannot authorize it.
      if (req.method === 'POST' && req.url === '/capability/rpc') {
        let lease: CapabilityLease
        let ctx: Ctx
        try {
          lease = JSON.parse(String(req.headers['x-eas-capability'] ?? '')) as CapabilityLease
          ctx = capabilitySessions.authenticate(lease)
        } catch { return send(401, { ok: false, error: '能力会话授权无效或已撤销' }) }
        if (!mcpEnabled) return send(403, { ok: false, error: '内置能力已禁用' })
        const body = JSON.parse(await readBody(req)) as { module?: string; connectionId?: string; method?: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } }
        const module = String(body.module ?? '')
        const params = body.params ?? {}
        const connectionId = String(body.connectionId ?? '')
        if (!connectionId || !['workbench', 'bizone'].includes(module)) return send(400, { ok: false, error: '能力连接身份无效' })
        ctx = capabilitySessions.authenticate(lease)
        if (!capabilityPreferences().preferences[module as 'workbench' | 'bizone']) return send(403, { ok: false, error: '内置模块已禁用' })
        if (body.method === 'close') {
          builtinCapabilityHost.releaseModule(lease.id, module, connectionId)
          return send(200, { ok: true, result: {} })
        }
        if (body.method === 'initialize' || body.method === 'tools/list') {
          const tools = await builtinCapabilityHost.list(module, lease.id, connectionId)
          const result = body.method === 'tools/list' ? { tools } : {
            protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} },
            serverInfo: { name: `eas-capabilities-${module}`, version: app.getVersion() }
          }
          return send(200, { ok: true, result })
        }
        if (body.method === 'tools/call') {
          // Context is resolved above from the lease. Ignore all caller-supplied context/_meta.
          const result = await builtinCapabilityHost.call(module, lease.id, connectionId, String(params.name ?? ''), params.arguments ?? {}, ctx, () => {
            capabilitySessions.authenticate(lease)
            if (!mcpEnabled || !capabilityPreferences().preferences[module as 'workbench' | 'bizone']) throw new Error('内置能力已禁用')
          })
          if (module === 'workbench' && !(result as { isError?: boolean })?.isError) {
            try { capabilityMigrationService().onSuccessfulWorkbenchCall(ctx.project) }
            catch { console.warn('[capabilities] legacy rule migration deferred; tool result preserved') }
          }
          return send(200, { ok: true, result })
        }
        if (body.method === 'ping') {
          const connected = builtinCapabilityHost.heartbeat(module, lease.id, connectionId)
          return send(connected ? 200 : 409, { ok: connected, ...(connected ? { result: {} } : { error: '能力连接已释放，请重新握手' }) })
        }
        return send(400, { ok: false, error: '不支持的内置能力方法' })
      }
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
          // 同一份数据也喂给额度存储 —— 它要落盘 + 给右上角那个常驻 bar 用。
          // **不改上面那条广播**：对话工具栏那套还照旧走 statusline:data。
          // 放在循环**外**：ingest 跟窗口数量无关，一次回传只该记一次。
          // （原来写在循环体内：多开一个窗口就重复落盘一次，而一个窗口都没有时
          //   连一次都不记 —— 后者正是启动早期最容易丢数据的时刻。）
          ingestStatusline(j)
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

      // ── 自家插件的转发 shim（mcp/eas-plugin-shim.mjs）→ 宿主里的插件进程 ──
      // 同一把 token；RPC 本体在 pluginHost.ts。心跳/告别用来释放对进程的引用。
      if (req.method === 'POST' && req.url === '/plugin/rpc') {
        const body = JSON.parse((await readBody(req)) || '{}') as Parameters<typeof pluginRpcFromShim>[0]
        return send(200, await pluginRpcFromShim(body))
      }
      if (req.method === 'POST' && req.url === '/plugin/heartbeat') {
        const body = JSON.parse((await readBody(req)) || '{}') as { shimId?: string }
        pluginHeartbeat(String(body.shimId ?? ''))
        return send(200, { ok: true })
      }
      if (req.method === 'POST' && req.url === '/plugin/bye') {
        const body = JSON.parse((await readBody(req)) || '{}') as { shimId?: string }
        pluginBye(String(body.shimId ?? ''))
        return send(200, { ok: true })
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
