// 扫出用户**已安装**的 CLI 插件，归一化成 PluginInfo 交给画布用。
//
// ── 为什么读文件而不是跑 `codex plugin list` / `claude plugin list` ──────────
// 那两条命令的输出是给人看的表格，格式随版本变，解析它等于把功能挂在别人的
// 排版习惯上。项目里既有的做法也是读文件（mcpBridge 读 ~/.claude.json 而不是
// 跑 `claude mcp list`），这里保持一致。
//
// ── 两个生态的真实形状（2026-08-24 在本机逐个拆出来的，不是照文档推断）──────
//
// **Codex**：`~/.codex/plugins/cache/<市场>/<插件>/`
//   · 装没装看目录里有没有 `.codex-remote-plugin-install.json`
//   · 清单在**再下一层版本目录**里：`<版本>/.codex-plugin/plugin.json`
//     （少算这一层会读不到，实测踩过）
//   · 元数据很全：`interface` 块带 displayName / category / brandColor /
//     composerIcon / defaultPrompt
//   · **两种子形状**：
//       连接器型 —— 只有 `apps`（一个远程 id），本地没有任何工具定义
//       本地型   —— 有 `.mcp.json` 和 `skills/`
//
// **Claude Code**：`~/.claude/plugins/cache/<市场>/<插件>/<版本>/`
//   · 装了哪些看 `~/.claude/plugins/installed_plugins.json`
//   · 清单在 `.claude-plugin/plugin.json`，**只有 name/description/author**，
//     没有任何展示元数据 —— 图标、分类、品牌色、默认提示词全都没有，
//     UI 那边必须能接受这些字段为空。
//   · MCP 在同级的 `.mcp.json`，值里带 `${CLAUDE_PLUGIN_ROOT}` 变量
//
// ── 纪律 ──────────────────────────────────────────────────────────────────
// **只读，绝不写。** 装插件是 `codex plugin add` / `claude plugin install` 的事，
// 而那条命令只能预填进终端交给用户按回车，不许代跑 —— 理由同 agentInstall.ts：
// 静默装全局 CLI + 改配置是恶意软件的行为特征。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ipcMain } from 'electron'

import type { PluginInfo } from '../shared/types'
import { parseManifest } from './pluginManifest.ts'
import { app } from 'electron'

const rd = (p: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}
const rec = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** 列一个目录下的子目录名。目录不存在就是空 —— 没装过任何插件是常态，不是错误。 */
function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

/** 一个插件目录下可能有多个版本，取**最新写入**的那个。
 *  按 mtime 而不是按版本号排序：版本号格式各家不一（`0.1.11-5f7cd798dc99`
 *  这种带 hash 的排不出大小），而「最后装的那个」用 mtime 判永远是对的。 */
function newestVersionDir(pluginDir: string): string | undefined {
  const cands = subdirs(pluginDir)
    .map((n) => ({ n, p: path.join(pluginDir, n) }))
    .filter((c) => fs.existsSync(path.join(c.p, '.codex-plugin')) || fs.existsSync(path.join(c.p, '.claude-plugin')))
  if (!cands.length) return undefined
  let best = cands[0]
  let bestAt = 0
  for (const c of cands) {
    let at = 0
    try {
      at = fs.statSync(c.p).mtimeMs
    } catch {
      /* 读不到就当最老 */
    }
    if (at >= bestAt) {
      bestAt = at
      best = c
    }
  }
  return best.p
}

/** 把清单里的相对图标路径解成绝对路径。解不开就不给 —— UI 有兜底图标。 */
function iconAbs(root: string, rel: unknown): string | undefined {
  const r = str(rel)
  if (!r) return undefined
  const abs = path.resolve(root, r)
  return fs.existsSync(abs) ? abs : undefined
}

function codexPlugins(): PluginInfo[] {
  const cache = path.join(os.homedir(), '.codex', 'plugins', 'cache')
  const out: PluginInfo[] = []
  for (const market of subdirs(cache)) {
    for (const name of subdirs(path.join(cache, market))) {
      const pdir = path.join(cache, market, name)
      // **装没装的唯一判据。** 缓存目录里可能躺着下载但没装完的东西，
      // 没有这个标记就不算装上 —— 列出来用户点了会失败。
      if (!fs.existsSync(path.join(pdir, '.codex-remote-plugin-install.json'))) continue
      const vdir = newestVersionDir(pdir)
      if (!vdir) continue
      const m = rec(rd(path.join(vdir, '.codex-plugin', 'plugin.json')))
      if (!m) continue
      const i = rec(m.interface) ?? {}
      const dp = Array.isArray(i.defaultPrompt) ? str(i.defaultPrompt[0]) : undefined
      const mcp = rec(rd(path.join(vdir, '.mcp.json')))
      out.push({
        id: `codex:${name}`,
        cli: 'codex',
        name,
        displayName: str(i.displayName) ?? str(m.name) ?? name,
        description: str(i.shortDescription) ?? str(m.description),
        category: str(i.category),
        brandColor: str(i.brandColor),
        iconPath: iconAbs(vdir, i.composerIcon) ?? iconAbs(vdir, i.logo),
        defaultPrompt: dp,
        // 连接器型没有这个字段，留 undefined —— 调用方据此判断「有没有本地工具要合并」
        mcpServers: rec(mcp?.mcpServers),
        root: vdir
      })
    }
  }
  return out
}

function claudePlugins(): PluginInfo[] {
  const base = path.join(os.homedir(), '.claude', 'plugins')
  const installed = rec(rd(path.join(base, 'installed_plugins.json')))
  // 结构是 { version, plugins }，plugins 的形状按版本可能变 ——
  // 认不出就退回「扫缓存目录」，宁可多列几个也别一个都列不出来。
  const named = new Set<string>()
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(collect)
    else if (typeof v === 'string') named.add(v.split('@')[0])
    else {
      const r = rec(v)
      if (r) for (const [k, vv] of Object.entries(r)) {
        named.add(k.split('@')[0])
        collect(vv)
      }
    }
  }
  collect(installed?.plugins)

  const cache = path.join(base, 'cache')
  const out: PluginInfo[] = []
  for (const owner of subdirs(cache)) {
    for (const name of subdirs(path.join(cache, owner))) {
      // installed_plugins.json 认得出来就按它筛；整份读不懂时 named 为空，
      // 那就不筛（缓存目录里的基本都是装过的）
      if (named.size && !named.has(name)) continue
      const vdir = newestVersionDir(path.join(cache, owner, name))
      if (!vdir) continue
      const m = rec(rd(path.join(vdir, '.claude-plugin', 'plugin.json')))
      if (!m) continue
      const mcp = rec(rd(path.join(vdir, '.mcp.json')))
      out.push({
        id: `claude:${name}`,
        cli: 'claude',
        name,
        // Claude 的清单里**没有 displayName**，只能用 name。UI 别指望这里有好看的名字。
        displayName: str(m.name) ?? name,
        description: str(m.description),
        iconPath: undefined, // Claude 插件不带图标
        defaultPrompt: undefined, // 也不带默认提示词
        mcpServers: rec(mcp?.mcpServers),
        root: vdir
      })
    }
  }
  return out
}

// ── 自家插件（cli === 'eas'）──────────────────────────────────────────────
// 设计稿 docs/superpowers/specs/2026-09-05-插件面板宿主-design.md §M。
// 两个来源：随包的样板（resources/plugins/，内置）+ 用户自己的 ~/.eas/plugins/；
// **同名用户覆盖内置**。清单校验在 pluginManifest.ts（纯函数，有测试）。
/** 随包分发的样板目录（同 agent-hooks 的定位方式） */
export function builtinPluginsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'plugins') : path.join(app.getAppPath(), 'resources', 'plugins')
}
export function userPluginsDir(): string {
  return path.join(os.homedir(), '.eas', 'plugins')
}
function easPluginsIn(root: string, builtin: boolean): PluginInfo[] {
  const out: PluginInfo[] = []
  for (const name of subdirs(root)) {
    const dir = path.join(root, name)
    const raw = rd(path.join(dir, 'plugin.json'))
    if (raw === undefined) continue // 没有清单的目录不是插件，静默跳过
    const r = parseManifest(raw, dir, { builtin, exists: (p) => fs.existsSync(p) })
    if (!r.ok) {
      console.warn(`[plugin] 跳过 ${dir}：${r.errors.join('；')}`)
      continue
    }
    for (const w of r.warnings) console.warn(`[plugin] ${name}：${w}`)
    out.push(r.info)
  }
  return out
}
function easPlugins(): PluginInfo[] {
  const user = easPluginsIn(userPluginsDir(), false)
  const taken = new Set(user.map((p) => p.name))
  const builtin = easPluginsIn(builtinPluginsDir(), true).filter((p) => !taken.has(p.name))
  return [...user, ...builtin]
}

/** 已装插件全表。**每次都当场扫盘**，不缓存 —— 用户可能刚在终端里装了一个，
 *  缓存会让他看不到，而扫几个目录的代价可以忽略。
 *  顺序：自家插件在前（它们有面板，是画布上真正能「插」的东西），两家的按名排后。 */
export function listPlugins(): PluginInfo[] {
  const others = [...codexPlugins(), ...claudePlugins()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh'))
  return [...easPlugins(), ...others]
}

/** 按 id 取一个。给「这次会话带哪个插件」那条路用。 */
export function findPlugin(id: string): PluginInfo | undefined {
  return listPlugins().find((p) => p.id === id)
}

export function registerPluginHandlers(): void {
  ipcMain.handle('plugins:list', (): PluginInfo[] => listPlugins())
}
