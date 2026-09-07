// 分支台账 .eas/board/<branch>.md：头部由 app 从事实算（协同板每次刷新时 upsert），
// 「记录」段只追加（board_note）。文本逻辑在 shared/roleDocs.ts，这里只管 fs 与串行。
//
// **同一项目的读改写排成一条链** —— upsert 与 append 都是读→改→写，叠在一起会把
// 对方那次改动写丢（upsert 读到没有新记录的旧文，append 读到旧头部，谁后写谁赢）。
//
// **不 import electron**，裸测得了（见 branchLedger.test.ts）。
import fs from 'fs'
import path from 'path'

import type { BoardRow } from '../shared/board.ts'
import { LEDGER_DIR, appendLedgerNote, clipTail, ledgerRel, renderLedger, splitLedger } from '../shared/roleDocs.ts'

/** 这两个不是分支名：`currentBranch` 失败给 `?`，detached HEAD 给 `HEAD`。
 *  给它们造台账只会得到一份没人认领的 `?.md` / `HEAD.md`。 */
const NOT_A_BRANCH = new Set(['?', 'HEAD'])

const chain = new Map<string, Promise<unknown>>()
function enqueue<T>(root: string, fn: () => T | Promise<T>): Promise<T> {
  const next = (chain.get(root) ?? Promise.resolve())
    .catch(() => {
      /* 上一次失败不该拖累这一次 */
    })
    .then(fn)
  chain.set(root, next)
  // 链尾是自己才清，否则会把后面排队的那条抹掉。`.catch` 兜住：这条派生 promise
  // 没人 await，fn 抛了不该变成 unhandled rejection。
  next
    .catch(() => {})
    .finally(() => {
      if (chain.get(root) === next) chain.delete(root)
    })
  return next
}

/** 等这个项目在飞的读改写都落完。`board:read` 读台账前先 await 它 ——
 *  板刚写完就 read，`upsertLedgers` 可能还在链上没跑到，读到的是上一版头部。 */
export function ledgerIdle(root: string): Promise<void> {
  return (chain.get(root) ?? Promise.resolve()).then(
    () => undefined,
    () => undefined
  )
}

function readText(abs: string): string {
  try {
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return ''
  }
}

/** 临时文件 + rename：几条会话同时刷板时不会写出半截 */
function writeAtomic(abs: string, text: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, abs)
}

/** 协同板每次刷新时调：板上每条**分支**都 upsert 一次头部，记录段原样接回。
 *  主工作区那行（`cwd === root`）没有自己的台账 —— 它的 branch 是「主工作区（main）」这种
 *  展示串，不是分支名。 */
export function upsertLedgers(root: string, rows: BoardRow[], now = Date.now()): Promise<void> {
  return enqueue(root, () => {
    for (const r of rows) {
      if (r.cwd === root || NOT_A_BRANCH.has(r.branch)) continue
      const rel = ledgerRel(r.branch)
      if (!rel) continue
      const abs = path.join(root, rel)
      // 旧文里找不到「## 记录」标题（手改过 / 被别的东西写过）时，整份旧文当 notes 接回，
      // 不能当空 —— 头部我们重算，但别人写进去的字一个都不能丢。
      const old = readText(abs)
      const split = splitLedger(old)
      const notes = split.found ? split.notes : old
      const worktree = path.relative(root, r.cwd).split(path.sep).join('/') || null
      try {
        writeAtomic(
          abs,
          renderLedger(
            {
              branch: r.branch,
              roleName: r.roleName,
              worktree,
              startedAt: r.startedAt,
              lastActiveAt: now - r.idleMs,
              alive: r.alive,
              files: r.files
            },
            notes,
            now
          )
        )
      } catch {
        /* 台账写不出不影响板 */
      }
    }
  })
}

/** 往某条分支台账的「记录」段追加一条。note 收口 4000 字 —— 台账是交接纪要，不是日志。 */
export function appendNote(
  root: string,
  branch: string,
  note: string,
  roleName: string
): Promise<{ ok: true; rel: string } | { ok: false; error: string }> {
  const rel = NOT_A_BRANCH.has(branch) ? null : ledgerRel(branch)
  if (!rel) return Promise.resolve({ ok: false, error: `分支名「${branch}」不能当台账文件名` })
  const text = note.trim().slice(0, 4000)
  if (!text) return Promise.resolve({ ok: false, error: 'note 不能为空' })
  return enqueue(root, () => {
    const abs = path.join(root, rel)
    try {
      writeAtomic(abs, appendLedgerNote(readText(abs), text, roleName, Date.now()))
      return { ok: true as const, rel }
    } catch (e) {
      return { ok: false as const, error: `台账写不进去：${e instanceof Error ? e.message : String(e)}` }
    }
  })
}

/** `renderLedger` 固定把分支名写在首行 `# 台账 · <branch>`，从那里反推。
 *  文件名是分支名「压」出来的（`/` → `--`），反推不回去，所以只认首行。 */
const TITLE_RE = /^# 台账 · (.+?)[ \t]*\r?\n/

/** 磁盘上现有的台账：分支名 → 绝对路径。扫 `.eas/board/*.md`（临时文件 `.tmp` 自然落在外面），
 *  首行读不出分支名的文件不算。会话被回收（页面重载 / 关窗）后台账文件还在，
 *  这份清单不依赖会话表 —— 合并官必须读得到那些没人在线的分支写下的交接。 */
export function ledgerFiles(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const dir = path.join(root, LEDGER_DIR)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const n of names.sort()) {
    if (!n.endsWith('.md')) continue
    const abs = path.join(dir, n)
    const m = TITLE_RE.exec(readText(abs))
    const branch = m?.[1]
    if (!branch || NOT_A_BRANCH.has(branch)) continue
    out.set(branch, abs)
  }
  return out
}

/** 给 board_read 带回去的台账：**磁盘上有的 ∪ 板上有的**，每份只留尾部
 * （合并官要的是最近的决定与提醒）。板上有但文件还没落的分支不出现在结果里。 */
export function readLedgers(root: string, branches: string[], maxLines = 30): Record<string, string> {
  const files = ledgerFiles(root)
  for (const b of branches) {
    if (files.has(b) || NOT_A_BRANCH.has(b)) continue
    const rel = ledgerRel(b)
    if (rel) files.set(b, path.join(root, rel))
  }
  const out: Record<string, string> = {}
  for (const [b, abs] of files) {
    const t = readText(abs)
    if (t) out[b] = clipTail(t, maxLines)
  }
  return out
}
