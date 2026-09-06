// 协同板：**从事实算**（会话表 + git），不是模型自报。渲染在 shared/board.ts。
//
// ⚠️ **不要并进 `main/board.ts`** —— 那个 board 是项目看板的列（待执行/进行中/已完结），
// 跟这里的「哪条分支上有谁在改哪些文件」是两件毫不相干的事，只是中文都叫「板」。
// 它已经占了 `registerBoardHandlers` 和 `board:list` / `board:save` / `board:newId`；
// 本文件走 `board:refresh` / `board:read`，渲染层同挂在 `window.api.board` 下。
//
// 写文件用临时文件 + rename：多条会话同时触发刷新时不会写出半截。
// `.eas/` 写进项目的 .git/info/exclude 而不是 .gitignore —— 不动用户提交的文件。
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'

import { BOARD_REL, findOverlaps, renderBoard, type BoardRow, type Overlap } from '../shared/board'
import { belongsToProject } from '../shared/teamWorktree'
import { BUILTIN_ROLES } from './builtinRoles'
import type { SessionRecord } from './agentChat/sessionState'

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 15_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (err ? stderr || stdout : stdout).toString().trim() })
    })
  })
}

/** 这条分支从哪个提交长出来的：reflog 最早一条就是 `worktree add -b` 那一下 */
async function forkPoint(cwd: string, branch: string): Promise<string | null> {
  const r = await git(cwd, ['reflog', 'show', '--format=%H', branch])
  if (!r.ok || !r.out) return null
  const lines = r.out.split('\n').filter(Boolean)
  return lines[lines.length - 1] ?? null
}

/** 触及文件 = 相对 fork 点的已提交改动 ∪ 工作区未提交改动（含未跟踪） */
export async function touchedFiles(cwd: string, branch: string): Promise<string[]> {
  const set = new Set<string>()
  const base = await forkPoint(cwd, branch)
  if (base) {
    const d = await git(cwd, ['diff', '--name-only', base])
    if (d.ok) d.out.split('\n').filter(Boolean).forEach((f) => set.add(f))
  }
  const st = await git(cwd, ['status', '--porcelain', '--untracked-files=all'])
  if (st.ok) st.out.split('\n').filter(Boolean).forEach((l) => set.add(l.slice(3).trim()))
  return [...set].sort()
}

async function currentBranch(cwd: string): Promise<string> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.ok ? r.out : '?'
}

/** 会话表由 session.ts 启动时注入（它也要 import 本模块刷板，直接互相 import 会成环）。
 *  没注入时板永远是空的 —— 宁可空，不要在模块初始化期去碰 electron 那边的单例。 */
let sessionSource: () => SessionRecord[] = () => []
export function setSessionSource(fn: () => SessionRecord[]): void {
  sessionSource = fn
}

/** 会话表 + git → rows。只收「属于这个项目」的会话（含 .worktrees/ 下的） */
export async function collectRows(
  projectPath: string,
  roleNames: Record<string, string>,
  now = Date.now()
): Promise<BoardRow[]> {
  const rows: BoardRow[] = []
  for (const rec of sessionSource()) {
    if (!belongsToProject(rec.cwd, projectPath)) continue
    if (!rec.roleId && rec.cwd === projectPath) continue // 主工作区里没角色的会话不上板
    const branch = await currentBranch(rec.cwd)
    const files = rec.cwd === projectPath ? [] : await touchedFiles(rec.cwd, branch)
    rows.push({
      branch: rec.cwd === projectPath ? `主工作区（${branch}）` : branch,
      roleName: (rec.roleId && roleNames[rec.roleId]) || rec.roleId || rec.role || '无角色',
      roleId: rec.roleId,
      alive: rec.alive,
      idleMs: Math.max(0, now - rec.lastActiveAt),
      startedAt: rec.startedAt,
      files,
      cwd: rec.cwd
    })
  }
  return rows
}

function ensureExcluded(projectPath: string): void {
  try {
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) return
    const info = path.join(gitDir, 'info')
    fs.mkdirSync(info, { recursive: true })
    const f = path.join(info, 'exclude')
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
    if (!cur.split('\n').some((l) => l.trim() === '.eas/'))
      fs.appendFileSync(f, (cur.endsWith('\n') || !cur ? '' : '\n') + '.eas/\n')
  } catch {
    /* 排除失败不阻断：板照写，最多在 git status 里多一行 */
  }
}

const timers = new Map<string, NodeJS.Timeout>()
/** 防抖 500ms：一轮 turn.done 常常紧跟 exit，别连写两次 */
export function refreshBoard(projectPath: string): void {
  const t = timers.get(projectPath)
  if (t) clearTimeout(t)
  timers.set(
    projectPath,
    setTimeout(() => {
      timers.delete(projectPath)
      void writeBoard(projectPath)
    }, 500)
  )
}

let roleNameLookup: () => Record<string, string> = () =>
  Object.fromEntries(BUILTIN_ROLES.map((r) => [r.id, r.name]))
/** roles.ts 启动后把「含用户自建角色」的查询函数装进来，板上才显示得出自建角色的名字 */
export function setRoleNameLookup(fn: () => Record<string, string>): void {
  roleNameLookup = fn
}

export async function writeBoard(projectPath: string): Promise<void> {
  try {
    const rows = await collectRows(projectPath, roleNameLookup())
    const text = renderBoard(rows, Date.now())
    ensureExcluded(projectPath)
    const f = path.join(projectPath, BOARD_REL)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    const tmp = `${f}.${process.pid}.tmp`
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, f)
  } catch {
    /* 板写不出来不影响会话 */
  }
}

export function readBoard(projectPath: string): string {
  try {
    return fs.readFileSync(path.join(projectPath, BOARD_REL), 'utf8')
  } catch {
    return ''
  }
}

/** 名字带 Collab 是**必须的**：`main/board.ts`（项目看板的列）已经导出了
 *  `registerBoardHandlers`，重名会直接编译不过。 */
export function registerCollabBoardHandlers(): void {
  ipcMain.handle('board:refresh', async (_e, projectPath: unknown) => {
    if (typeof projectPath !== 'string') return { ok: false }
    await writeBoard(projectPath)
    return { ok: true }
  })
  ipcMain.handle(
    'board:read',
    async (_e, projectPath: unknown): Promise<{ text: string; rows: BoardRow[]; overlaps: Overlap[] }> => {
      if (typeof projectPath !== 'string') return { text: '', rows: [], overlaps: [] }
      const rows = await collectRows(projectPath, roleNameLookup())
      return { text: readBoard(projectPath), rows, overlaps: findOverlaps(rows) }
    }
  )
}
