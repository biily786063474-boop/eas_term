// 协同板：**从事实算**（会话表 + git），不是模型自报。渲染在 shared/board.ts。
//
// ⚠️ **不要并进 `main/board.ts`** —— 那个 board 是项目看板的列（待执行/进行中/已完结），
// 跟这里的「哪条分支上有谁在改哪些文件」是两件毫不相干的事，只是中文都叫「板」。
// 它已经占了 `registerBoardHandlers` 和 `board:list` / `board:save` / `board:newId`；
// 本文件走 `board:refresh` / `board:read`，渲染层同挂在 `window.api.board` 下。
//
// 写文件用临时文件 + rename：多条会话同时触发刷新时不会写出半截。
// `.eas/` 写进项目的 .git/info/exclude 而不是 .gitignore —— 不动用户提交的文件。
import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'

import { BOARD_REL, findOverlaps, renderBoard, type BoardRow, type Overlap } from '../shared/board'
import { belongsToProject } from '../shared/teamWorktree'
import { projectRootOf } from '../shared/roleWorktree'
import { BUILTIN_ROLES } from './builtinRoles'
import { gitExec, parseNameOnly, parsePorcelain } from './gitExec.ts'
import type { SessionRecord } from './agentChat/sessionState'

// 解析逻辑住在 electron-free 的 gitExec.ts（那边才裸测得了，见 collabBoard.test.ts
// 文件头）。这里 re-export 一份，别处要用不必知道它被拆到哪去了。
export { parsePorcelain } from './gitExec.ts'

/** 这条分支从哪个提交长出来的：reflog 最早一条就是 `worktree add -b` 那一下 */
async function forkPoint(cwd: string, branch: string): Promise<string | null> {
  const r = await gitExec(cwd, ['reflog', 'show', '--format=%H', branch])
  if (!r.ok || !r.out) return null
  const lines = r.out.split('\n').filter(Boolean)
  return lines[lines.length - 1] ?? null
}

/** 触及文件 = 相对 fork 点的已提交改动 ∪ 工作区未提交改动（含未跟踪）。
 *
 *  fork 点和工作区状态**互不依赖，一起跑** —— 刷板挂在 turn.done 上，
 *  用户正等着看下一句话，能省一个 git 往返就省一个。 */
export async function touchedFiles(cwd: string, branch: string): Promise<string[]> {
  const set = new Set<string>()
  const [base, st] = await Promise.all([
    forkPoint(cwd, branch),
    gitExec(cwd, ['status', '--porcelain', '--untracked-files=all'])
  ])
  if (st.ok) parsePorcelain(st.out).forEach((f) => set.add(f))
  // diff 要等 fork 点算出来，这一步没法再往前并
  if (base) {
    const d = await gitExec(cwd, ['diff', '--name-only', base])
    if (d.ok) parseNameOnly(d.out).forEach((f) => set.add(f))
  }
  return [...set].sort()
}

async function currentBranch(cwd: string): Promise<string> {
  const r = await gitExec(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.ok ? r.out : '?'
}

/** 会话表由 session.ts 启动时注入（它也要 import 本模块刷板，直接互相 import 会成环）。
 *  没注入时板永远是空的 —— 宁可空，不要在模块初始化期去碰 electron 那边的单例。 */
let sessionSource: () => SessionRecord[] = () => []
export function setSessionSource(fn: () => SessionRecord[]): void {
  sessionSource = fn
}

/** 会话表 + git → rows。只收「属于这个项目」的会话（含 .worktrees/ 下的）。
 *
 *  **会话之间并行**：每条会话要跑 3 个 git，串起来的话 5 条会话就是 15 个往返
 *  首尾相接，而刷板挂在 turn.done 上 —— 那正是用户盯着屏幕等下一句话的时刻。
 *  `Promise.all` 保序，板上的行序和以前一样。 */
export async function collectRows(
  projectPath: string,
  roleNames: Record<string, string>,
  now = Date.now()
): Promise<BoardRow[]> {
  // 主工作区里没角色的会话不上板（普通 AI 对话不是「一条在改东西的分支」）
  const mine = sessionSource().filter(
    (rec) => belongsToProject(rec.cwd, projectPath) && (rec.roleId || rec.cwd !== projectPath)
  )
  return Promise.all(
    mine.map(async (rec): Promise<BoardRow> => {
      const branch = await currentBranch(rec.cwd)
      const files = rec.cwd === projectPath ? [] : await touchedFiles(rec.cwd, branch)
      return {
        branch: rec.cwd === projectPath ? `主工作区（${branch}）` : branch,
        roleName: (rec.roleId && roleNames[rec.roleId]) || rec.roleId || rec.role || '无角色',
        roleId: rec.roleId,
        alive: rec.alive,
        idleMs: Math.max(0, now - rec.lastActiveAt),
        startedAt: rec.startedAt,
        files,
        cwd: rec.cwd
      }
    })
  )
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

/** 每个项目一条串行链：在飞的那次跑完，排队的那次才开始。 */
const chain = new Map<string, Promise<void>>()
/** 这个项目已经排了一次「回来再刷」，后面来的跟着它就行，不必再排。 */
const queued = new Set<string>()

/**
 * 刷板并落盘。**同一个项目永不并发。**
 *
 * 防抖（refreshBoard）只挡得住「还没开始」的那些，挡不住已经在跑 collectRows
 * （一串 git，可能好几百毫秒）的这一次。两次叠在一起：白跑一遍 git，而且可能
 * 后发的先写完、板上留下更旧的一版。
 *
 * 所以按项目排成一条链，且**最多只排一个**在等 —— 连着来十次刷新请求，也只会在
 * 当前这次之后再跑一次，那一次读到的已经是最新的会话表了。
 *
 * **返回的 promise 一定等到「至少一次开始时间不早于本次调用」的写盘完成。**
 * 这条是给 `board:refresh` 用的：Task 4 的 `board_read` 是「先 refresh 再 read」，
 * 要是 refresh 在排队那一刻就返回，读到的还是旧板，那这趟 refresh 就白做了。
 */
export function writeBoard(projectPath: string): Promise<void> {
  const prev = chain.get(projectPath)
  // 已经有人排过队了 —— 那一次开始时读的会话表比我们还新，跟着它就行
  if (prev && queued.has(projectPath)) return prev
  const next = (prev ?? Promise.resolve())
    .catch(() => {
      /* 上一次失败不该拖累这一次 */
    })
    .then(() => {
      queued.delete(projectPath)
      return doWriteBoard(projectPath)
    })
    .finally(() => {
      // 链尾是自己才清，否则会把后面排队的那条抹掉
      if (chain.get(projectPath) === next) chain.delete(projectPath)
    })
  if (prev) queued.add(projectPath)
  chain.set(projectPath, next)
  return next
}

async function doWriteBoard(projectPath: string): Promise<void> {
  try {
    const rows = await collectRows(projectPath, roleNameLookup())
    const f = path.join(projectPath, BOARD_REL)
    // **一条都收不到时，不要凭空造出一个文件。**
    // 板是给「几条分支各自在改什么」用的。一个普通 AI 对话（没角色、就在项目根）
    // 一条 row 都收不到，此前却照样会在它的 cwd 写出一份「没有活跃分支」的
    // `.eas/board.md`，还顺手改人家的 `.git/info/exclude` —— 而那个 cwd 可能是
    // `$HOME`，也可能是任何一个跟本功能毫无关系的目录。
    // 已经有板的情况仍然要写：从「有分支」到「一条都没有」时得把板清干净。
    if (!rows.length && !fs.existsSync(f)) return
    const text = renderBoard(rows, Date.now())
    ensureExcluded(projectPath)
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
  // 两个 handler 都**先归一到项目根**。调用方手上多半是会话的 cwd，而角色会话的 cwd
  // 就在 `.worktrees/<角色>-<id>/` 里 —— 不剥的话：refresh 会在那棵工作树底下再落一份
  // 板（真正那份没人更新），read 则因为 `belongsToProject(cwd, worktreeCwd)` 收不到
  // 任何会话而永远返回空板。板只有一份，在项目根的 .eas/ 下。
  ipcMain.handle('board:refresh', async (_e, projectPath: unknown) => {
    if (typeof projectPath !== 'string') return { ok: false }
    await writeBoard(projectRootOf(projectPath))
    return { ok: true }
  })
  ipcMain.handle(
    'board:read',
    async (_e, projectPath: unknown): Promise<{ text: string; rows: BoardRow[]; overlaps: Overlap[] }> => {
      if (typeof projectPath !== 'string') return { text: '', rows: [], overlaps: [] }
      const root = projectRootOf(projectPath)
      const rows = await collectRows(root, roleNameLookup())
      return { text: readBoard(root), rows, overlaps: findOverlaps(rows) }
    }
  )
}
