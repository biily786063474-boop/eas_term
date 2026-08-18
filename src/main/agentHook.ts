// 给 Claude Code / Codex 装「提交即复盘」钩子。
//
// 钩子干什么：git commit 之后扫这次提交的新增代码行，命中专业名词词典就记进
// <项目>/docs/knowledge-manual.html，同时把「用了但词典没收录」的术语沉淀到
// ~/.eas/dict-user.json —— 名词词典气泡会把它和内置词条合并显示。纯脚本，零 token。
//
// 这是三类配置里**侵入性最高**的一项：技能包只是让模型多读一份说明，
// 钩子是在用户每次跑命令时插入我们的代码，在他所有项目里，永久。
// 所以：必须显式问、必须能一键卸、写之前必须备份。
//
// 两边的落点不同：
//   · Claude Code → ~/.claude/settings.json 的 hooks.PostToolUse（用户自己的配置文件，得合并）
//   · Codex       → ~/.codex/hooks.json（专门放钩子的独立文件，安全得多）
//
// 为什么全程用 JSON.parse/stringify 而不是正则改文本：
// 之前用正则改 Codex 的 TOML，`[^[]*` 在 `args = [` 处截断，把用户真实配置写坏过。
// JSON 有现成的解析器，就别自己发明字符串手术。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import type { HookStatus, HookAgentStatus, AgentKind } from '../shared/types'

/** 认领标记：靠它找到「哪一条是我们装的」，做到幂等替换和干净卸载 */
const TAG = 'eas-term:knowledge-hook'

interface HookCmd {
  type: 'command'
  command: string
  commandWindows?: string
  timeout?: number
  /** 我们的认领标记。宿主不认识这个字段会原样保留，正好当记号用 */
  _easTerm?: string
}
interface HookEntry {
  matcher?: string
  hooks?: HookCmd[]
}

/** 钩子脚本源文件（打包后在 Resources/hooks） */
function scriptFile(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'hooks', 'scan-commit.mjs')
    : path.join(app.getAppPath(), 'hooks', 'scan-commit.mjs')
}

/**
 * 用哪个 node 跑它。
 * 主进程 GUI 启动时 PATH 很贫瘠，`node` 不一定能解析到 —— 所以探常见安装位置，
 * 写进配置的是**绝对路径**。写 `node` 会在一部分用户机器上静默失效，
 * 而钩子失效是不报错的（脚本设计成任何异常都 exit 0），排查起来极难。
 */
function nodeBin(): string | null {
  const home = app.getPath('home')
  const cands =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\nodejs\\node.exe',
          path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs', 'node.exe')
        ]
      : [
          '/opt/homebrew/bin/node',
          '/usr/local/bin/node',
          '/usr/bin/node',
          path.join(home, '.nvm', 'current', 'bin', 'node'),
          path.join(home, '.volta', 'bin', 'node')
        ]
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) {
    if (d) cands.push(path.join(d, process.platform === 'win32' ? 'node.exe' : 'node'))
  }
  for (const c of cands) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* 下一个 */
    }
  }
  return null
}

/** 路径含空格（"vibe coding" 这种）时必须带引号，否则钩子会被拆成两个参数 */
const q = (p: string): string => (/[\s"']/.test(p) ? `"${p}"` : p)

function buildCommand(): string | null {
  const node = nodeBin()
  const script = scriptFile()
  if (!node || !fs.existsSync(script)) return null
  return `${q(node)} ${q(script)}`
}

const claudeSettings = (): string => path.join(app.getPath('home'), '.claude', 'settings.json')
const codexHooks = (): string => path.join(app.getPath('home'), '.codex', 'hooks.json')

function readJson(f: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(f, 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 写之前先备份。用户的全局配置写坏了是灾难，一份 .eas-backup 不值几个字节 */
function writeJson(f: string, data: unknown): void {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  if (fs.existsSync(f)) {
    try {
      fs.copyFileSync(f, f + '.eas-backup')
    } catch {
      /* 备份失败不阻断，但也别声张 */
    }
  }
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n')
}

/** 从一份配置里找出我们装的那条（按标记，不按命令文本 —— 路径会随版本变） */
function findOurs(root: Record<string, unknown> | null): { entry: HookEntry; cmd: HookCmd } | null {
  const hooks = (root?.hooks ?? null) as Record<string, unknown> | null
  const list = (hooks?.PostToolUse ?? null) as HookEntry[] | null
  if (!Array.isArray(list)) return null
  for (const entry of list) {
    for (const c of entry.hooks ?? []) {
      if (c?._easTerm === TAG) return { entry, cmd: c }
    }
  }
  return null
}

/**
 * 用户自己配过同一个脚本吗（命令里出现 scan-commit.mjs，但没有我们的标记）。
 *
 * 这不是假想情况：把这个钩子手工配进 settings.json 的人，正是最可能来用这功能的人。
 * 不认出来就会并排装两条，同一个脚本每次提交跑两遍 —— 不致命（第二遍会因为
 * lastHash 已更新而空转）但纯属浪费，而且用户会以为是我们装重了。
 */
function findForeign(root: Record<string, unknown> | null): boolean {
  const list = ((root?.hooks as Record<string, unknown>)?.PostToolUse ?? null) as HookEntry[] | null
  if (!Array.isArray(list)) return false
  return list.some((e) =>
    (e.hooks ?? []).some((c) => c?._easTerm !== TAG && (c?.command ?? '').includes('scan-commit.mjs'))
  )
}

function statusOf(file: string, cliInstalled: boolean, want: string | null): HookAgentStatus {
  const root = readJson(file)
  const ours = findOurs(root)
  return {
    hasCli: cliInstalled,
    installed: !!ours,
    // 命令里嵌着 app 路径和 node 路径，换个位置装 app 就得重写一遍
    outdated: !!ours && !!want && ours.cmd.command !== want,
    foreign: !ours && findForeign(root),
    configPath: file
  }
}

/** 把我们那条塞进去（有就替换，没有就追加）。用户自己写的钩子一条都不动。 */
function install(file: string, matcher: string, cmd: string): void {
  const root = readJson(file) ?? {}
  const hooks = ((root.hooks as Record<string, unknown>) ?? {}) as Record<string, unknown>
  const list = (Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : []) as HookEntry[]
  const ours = findOurs({ hooks: { PostToolUse: list } })
  const payload: HookCmd = { type: 'command', command: cmd, timeout: 30, _easTerm: TAG }
  if (ours) {
    // 就地替换我们那条，保持它在数组里的原位置
    const i = (ours.entry.hooks ?? []).findIndex((c) => c?._easTerm === TAG)
    if (i >= 0) ours.entry.hooks![i] = payload
    ours.entry.matcher = matcher
  } else {
    list.push({ matcher, hooks: [payload] })
  }
  hooks.PostToolUse = list
  root.hooks = hooks
  writeJson(file, root)
}

/** 卸载：只摘我们那条。摘完如果这个 entry 空了就把 entry 也去掉，不留空壳 */
function uninstall(file: string): void {
  const root = readJson(file)
  if (!root) return
  const hooks = root.hooks as Record<string, unknown> | undefined
  const list = hooks?.PostToolUse as HookEntry[] | undefined
  if (!Array.isArray(list)) return
  let touched = false
  const next = list
    .map((entry) => {
      const before = entry.hooks?.length ?? 0
      const kept = (entry.hooks ?? []).filter((c) => c?._easTerm !== TAG)
      if (kept.length !== before) touched = true
      return { ...entry, hooks: kept }
    })
    .filter((entry) => (entry.hooks?.length ?? 0) > 0)
  if (!touched) return
  if (next.length) hooks!.PostToolUse = next
  else delete hooks!.PostToolUse
  if (hooks && Object.keys(hooks).length === 0) delete root.hooks
  writeJson(file, root)
}

export function hookStatus(hasClaude: boolean, hasCodex: boolean): HookStatus {
  const want = buildCommand()
  return {
    available: !!want,
    claude: statusOf(claudeSettings(), hasClaude, want),
    codex: statusOf(codexHooks(), hasCodex, want)
  }
}

export function registerHookHandlers(hasCli: (bin: string) => boolean): void {
  ipcMain.handle('hook:status', () => hookStatus(hasCli('claude'), hasCli('codex')))

  ipcMain.handle('hook:install', (_e, targets: (AgentKind)[]) => {
    const cmd = buildCommand()
    if (!cmd) return { ok: false, error: '找不到 node 或钩子脚本，无法安装' }
    const done: string[] = []
    try {
      // matcher 两边写法不同：Claude 是子串匹配，Codex 文档里用的是正则
      if (targets.includes('claude')) {
        install(claudeSettings(), 'Bash', cmd)
        done.push('Claude Code')
      }
      if (targets.includes('codex')) {
        install(codexHooks(), '^Bash$', cmd)
        done.push('Codex')
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    console.log('[hook] 已安装知识钩子：' + done.join(' / '))
    return { ok: true, done, status: hookStatus(hasCli('claude'), hasCli('codex')) }
  })

  ipcMain.handle('hook:uninstall', (_e, targets: (AgentKind)[]) => {
    try {
      if (targets.includes('claude')) uninstall(claudeSettings())
      if (targets.includes('codex')) uninstall(codexHooks())
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    return { ok: true, status: hookStatus(hasCli('claude'), hasCli('codex')) }
  })
}
