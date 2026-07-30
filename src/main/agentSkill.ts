// 给 Claude Code / Codex 装「配套技能包」。
//
// 为什么需要：MCP 只是把工具摆出去，模型不一定知道**什么时候该用**。
// 用户说「打开这个 html」，模型更可能去 Read 文件或跑 open，而不是 canvas_open_html。
// 技能包就是那份使用指引 —— 什么场景用哪个工具、边界在哪、分寸怎么把握。
//
// 两边的装法不同：
//   · Claude Code → ~/.claude/skills/eas-term/SKILL.md（原生 skill 机制）
//   · Codex       → ~/.codex/AGENTS.md 里插一段（Codex 没有 skill，全局指令走 AGENTS.md）
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import type { AgentStatus, SkillStatus } from '../shared/types'
import { expectedCodexRegion } from './agentRules'

const CODEX_BEGIN = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->'
const CODEX_END = '<!-- eas-term:end -->'

const prefsFile = (): string => path.join(app.getPath('userData'), 'skill-prefs.json')

function readPrefs(): { muted?: boolean } {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) as { muted?: boolean }
  } catch {
    return {}
  }
}
function writePrefs(p: { muted?: boolean }): void {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2))
  } catch (e) {
    console.error('[skill] 写偏好失败', e)
  }
}

/** 技能包源文件（打包后在 Resources/skills） */
function sourceFile(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'skills', 'eas-term', 'SKILL.md')
    : path.join(app.getAppPath(), 'skills', 'eas-term', 'SKILL.md')
}
function sourceText(): string | null {
  try {
    return fs.readFileSync(sourceFile(), 'utf8')
  } catch {
    return null
  }
}

/** CLI 在不在。主进程 GUI 启动时 PATH 很贫瘠（/usr/bin:/bin），所以是探常见安装位置而不是 which。 */
export function hasCli(bin: string): boolean {
  const home = app.getPath('home')
  const win = process.platform === 'win32'
  // Windows 的可执行文件带扩展名（npm 装的 CLI 通常是 .cmd），只查裸名会漏——
  // 结果就是「明明装了 Claude Code 却检测不到、不提示装技能包」
  const exts = win ? ['.cmd', '.exe', '.bat', '.ps1', ''] : ['']
  const dirs = win
    ? [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm')]
    : [
        path.join(home, '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        path.join(home, '.bun', 'bin'),
        path.join(home, '.npm-global', 'bin')
      ]
  // PATH 里也找一遍（从终端起的 app 能拿到完整 PATH）
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) {
    if (d) dirs.push(d)
  }
  const cands: string[] = []
  for (const d of dirs) for (const e of exts) cands.push(path.join(d, bin + e))
  return cands.some((c) => {
    try {
      return fs.existsSync(c)
    } catch {
      return false
    }
  })
}

const claudeSkillFile = (): string =>
  path.join(app.getPath('home'), '.claude', 'skills', 'eas-term', 'SKILL.md')
const codexAgentsFile = (): string => path.join(app.getPath('home'), '.codex', 'AGENTS.md')

// CODEX_BEGIN/END 这里只用来**定位**盘上那一段，不再用来生成内容 ——
// 生成是 agentRules.expectedCodexRegion() 的事，两边必须是同一个来源，
// 否则又会回到「盘上写的和期望的永远不相等」那个坑里。

export function skillStatus(): SkillStatus {
  const src = sourceText()
  const prefs = readPrefs()

  const claudeInstalled = ((): { installed: boolean; outdated: boolean } => {
    try {
      const cur = fs.readFileSync(claudeSkillFile(), 'utf8')
      return { installed: true, outdated: !!src && cur.trim() !== src.trim() }
    } catch {
      return { installed: false, outdated: false }
    }
  })()

  const codexInstalled = ((): { installed: boolean; outdated: boolean } => {
    try {
      const raw = fs.readFileSync(codexAgentsFile(), 'utf8')
      const i = raw.indexOf(CODEX_BEGIN)
      const j = raw.indexOf(CODEX_END)
      if (i < 0 || j < 0) return { installed: false, outdated: false }
      const cur = raw.slice(i, j + CODEX_END.length)
      // 必须拿 syncRules 真正会写的那段来比。这里原来比的是 codexBlock(src)，
      // 也就是「完整 SKILL.md 全文」—— 而实际写进去的是一段短路由，两者永不相等，
      // outdated 恒为真 → 首启弹窗每次启动都弹，点了「安装」也照弹不误。
      const want = expectedCodexRegion()
      return { installed: true, outdated: !!want && cur.trim() !== want.trim() }
    } catch {
      return { installed: false, outdated: false }
    }
  })()

  const claude: AgentStatus = { hasCli: hasCli('claude'), ...claudeInstalled }
  const codex: AgentStatus = { hasCli: hasCli('codex'), ...codexInstalled }
  const pending = (a: AgentStatus): boolean => a.hasCli && (!a.installed || a.outdated)
  return {
    claude,
    codex,
    muted: !!prefs.muted,
    needsAttention: !!src && (pending(claude) || pending(codex)),
    // 一个都没装：以前这种情况什么提示都不给，用户只看到一堆点了没反应的 agent 控件
    noCli: !claude.hasCli && !codex.hasCli
  }
}

export function registerSkillHandlers(): void {
  ipcMain.handle('skill:status', () => skillStatus())

  // 装指引统一走 rules:sync（agentRules.ts）。这里原来还有一个 skill:install，
  // 界面上早就没人调它了，但它会把**完整 SKILL.md 全文**灌进 ~/.codex/AGENTS.md ——
  // 一是那份文件全局常驻，塞全文等于长期占着每次会话的上下文（agentRules 里那段
  // 大注释专门在避免这件事）；二是它写出来的内容和 syncRules 写的对不上，
  // 谁要是调了它，「有更新待安装」就会重新变成恒为真。删掉，只留一条路。

  // 「永远不要提醒我」：只关掉启动弹窗，标题栏按钮照旧，用户随时能回来装
  ipcMain.handle('skill:mute', (_e, muted: boolean) => {
    writePrefs({ ...readPrefs(), muted })
    return skillStatus()
  })
}
