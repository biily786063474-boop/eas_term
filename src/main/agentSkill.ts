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
function hasCli(bin: string): boolean {
  const home = app.getPath('home')
  const cands = [
    path.join(home, '.local', 'bin', bin),
    '/opt/homebrew/bin/' + bin,
    '/usr/local/bin/' + bin,
    path.join(home, '.bun', 'bin', bin),
    path.join(home, '.npm-global', 'bin', bin)
  ]
  // PATH 里也找一遍（从终端起的 app 能拿到完整 PATH）
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) {
    if (d) cands.push(path.join(d, bin))
  }
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

/** Codex 的 AGENTS.md 里我们那一段（带首尾标记，方便幂等替换和整段移除） */
function codexBlock(text: string): string {
  return `${CODEX_BEGIN}\n\n${text}\n\n${CODEX_END}`
}

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
      return { installed: true, outdated: !!src && cur !== codexBlock(src) }
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
    needsAttention: !!src && (pending(claude) || pending(codex))
  }
}

function installClaude(text: string): void {
  const f = claudeSkillFile()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
}

/** Codex：按标记替换/追加，用户自己写在 AGENTS.md 里的内容一个字都不动 */
function installCodex(text: string): void {
  const f = codexAgentsFile()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
  const block = codexBlock(text)
  const i = raw.indexOf(CODEX_BEGIN)
  const j = raw.indexOf(CODEX_END)
  let next: string
  if (i >= 0 && j > i) {
    next = raw.slice(0, i) + block + raw.slice(j + CODEX_END.length)
  } else {
    next = raw.replace(/\n*$/, '') + (raw.trim() ? '\n\n' : '') + block + '\n'
  }
  if (raw) {
    try {
      fs.copyFileSync(f, f + '.eas-backup')
    } catch {
      /* 备份失败不阻断 */
    }
  }
  fs.writeFileSync(f, next)
}

export function registerSkillHandlers(): void {
  ipcMain.handle('skill:status', () => skillStatus())

  ipcMain.handle('skill:install', (_e, targets: ('claude' | 'codex')[]) => {
    const text = sourceText()
    if (!text) return { ok: false, error: '技能包源文件缺失' }
    const done: string[] = []
    try {
      if (targets.includes('claude')) {
        installClaude(text)
        done.push('Claude Code')
      }
      if (targets.includes('codex')) {
        installCodex(text)
        done.push('Codex')
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    console.log('[skill] 已安装技能包：' + done.join(' / '))
    return { ok: true, done, status: skillStatus() }
  })

  // 「永远不要提醒我」：只关掉启动弹窗，标题栏按钮照旧，用户随时能回来装
  ipcMain.handle('skill:mute', (_e, muted: boolean) => {
    writePrefs({ ...readPrefs(), muted })
    return skillStatus()
  })
}
