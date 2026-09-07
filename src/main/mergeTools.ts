// 合并官的两个只读工具的事实来源。**不改工作区**：冲突用 merge-tree 算，依赖用现成的 analyzeProject。
//
// 纯解析在 shared/mergePreflight.ts / shared/repoImpact.ts（零依赖、裸测）；这里只负责跑 git、
// 读文件、拼结果并挂 IPC。
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { ipcMain } from 'electron'

import { gitExec, parseNameOnly } from './gitExec.ts'
import { analyzeProject, type CodeGraphResult } from './codeGraphAnalyze.ts'
import { checkRoot } from './codeGraph'
import { collectRows } from './collabBoard'
import {
  inferTestCmd,
  isSafeRef,
  parseMergeTreeNameOnly,
  parseWorktreeList,
  pickDefaultBranch,
  type PreflightResult
} from '../shared/mergePreflight'
import { impactFrom, type ImpactResult } from '../shared/repoImpact'
import { projectRootOf } from '../shared/roleWorktree'
import type { Project } from '../shared/types'

type Fail = { ok: false; error: string }

let projectsSource: () => Project[] = () => []
/** projects.ts 启动时注入（同 collabBoard 的 setSessionSource 手法，避免互相 import） */
export function setProjectsSource(fn: () => Project[]): void {
  projectsSource = fn
}

interface GitCode {
  code: number
  stdout: string
  stderr: string
  /** 被超时掐掉的（execFile 的 killed） */
  killed: boolean
}

/**
 * 带退出码的 git。`gitExec` 只回 `{ ok, out }`，而 `merge-tree --write-tree` 用退出码区分
 * 「0 无冲突 / 1 有冲突 / ≥2 git 自己失败」—— 有冲突时 stdout 才是正文，光看 ok 分不清 1 和 2。
 * `rev-parse` 也走它：code 128 且 stderr 为空是「根本没有 git 命令」，与「不是仓库」要分开说。
 * 环境参数与 gitExec 保持一致（可选锁不取、路径不转义），理由见 gitExec.ts 顶部。
 */
function gitExecCode(cwd: string, args: string[], timeoutMs = 30_000): Promise<GitCode> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown; killed?: boolean }) | null
        const code = e ? (typeof e.code === 'number' ? e.code : 128) : 0
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString(), killed: !!e?.killed })
      }
    )
  })
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await gitExec(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${ref}`])).ok
}

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

// analyzeProject 一次几百毫秒到几秒；合并官一轮里会连着问几次，按项目缓存 5 分钟。
// 每次 preflight 是新一轮合并的开始 —— 那里会把这个项目的缓存清掉重算。
const graphCache = new Map<string, { at: number; graph: CodeGraphResult }>()

export async function preflight(projectPathRaw: string, branch: string): Promise<PreflightResult | Fail> {
  try {
    return await preflightInner(projectPathRaw, branch)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function preflightInner(projectPathRaw: string, branch: string): Promise<PreflightResult | Fail> {
  const projectPath = projectRootOf(projectPathRaw)
  const bad = checkRoot(projectPath)
  if (bad) return bad
  graphCache.delete(projectPath)
  if (!isSafeRef(branch)) return { ok: false, error: `分支名「${branch}」不合法` }

  const top = await gitExecCode(projectPath, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0) {
    if (top.code === 128 && !top.stderr.trim() && !top.stdout.trim()) return { ok: false, error: '找不到 git 命令' }
    return { ok: false, error: '这个目录不是 git 仓库' }
  }
  const note =
    realOrSelf(top.stdout.trim()) !== realOrSelf(projectPath) ? '项目注册在仓库子目录，路径以仓库根为准' : undefined

  if (!(await refExists(projectPath, branch))) return { ok: false, error: `分支 ${branch} 不存在` }

  const sym = await gitExec(projectPath, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'])
  const [hasMain, hasMaster] = await Promise.all([refExists(projectPath, 'main'), refExists(projectPath, 'master')])
  let defaultBranch = pickDefaultBranch(sym.ok ? sym.out : null, hasMain, hasMaster)
  // origin/HEAD 指向的名字本地可能没有对应分支（只 fetch 没 checkout），那就退回 main/master
  if (defaultBranch && !(await refExists(projectPath, defaultBranch)))
    defaultBranch = pickDefaultBranch(null, hasMain, hasMaster)
  if (!defaultBranch) return { ok: false, error: '找不到主干分支（没有 origin/HEAD、main 或 master）' }
  if (defaultBranch === branch) return { ok: false, error: `${branch} 就是主干，没有可合并的` }

  // 下面三处 git 一律用全限定名：同名 tag 会压过分支，git 只在 stderr 警告、退出码仍是 0，
  // 预检会给出假「无冲突」。返回值里的 branch / defaultBranch 仍是短名。
  const branchRef = `refs/heads/${branch}`
  const defaultRef = `refs/heads/${defaultBranch}`

  const baseR = await gitExec(projectPath, ['merge-base', defaultRef, branchRef])
  if (!baseR.ok) {
    if (!baseR.out.trim()) return { ok: false, error: '两条分支没有共同祖先（unrelated histories），不能按常规合并' }
    return { ok: false, error: `算不出合并基点：${baseR.out.slice(0, 200)}` }
  }
  const base = baseR.out.trim()

  const [changedR, mt, wl, rows] = await Promise.all([
    gitExec(projectPath, ['diff', '--name-only', `${base}..${branchRef}`]),
    gitExecCode(projectPath, ['merge-tree', '--write-tree', '--name-only', '--no-messages', defaultRef, branchRef]),
    gitExec(projectPath, ['worktree', 'list', '--porcelain']),
    collectRows(projectPath, {})
  ])
  const changed = changedR.ok ? parseNameOnly(changedR.out) : []
  const parsed = parseMergeTreeNameOnly(mt.stdout, mt.code)
  let conflictNote: string | undefined
  if (!parsed.ok) {
    if (mt.killed) conflictNote = '预检冲突超时；直接合并看结果，失败就 git merge --abort'
    else if (/unknown option|usage:/i.test(mt.stderr))
      conflictNote = '无法预检冲突（git merge-tree --write-tree 不可用，需要 git ≥ 2.38）；直接合并看结果，失败就 git merge --abort'
    else conflictNote = `预检冲突失败：${mt.stderr.trim().slice(0, 200) || '（git 没有输出）'}`
  }
  const worktree = wl.ok ? (parseWorktreeList(wl.out).find((w) => w.branch === branch)?.path ?? null) : null

  // 协同板上其他活跃分支与这条分支碰到的同一文件。不用 findOverlaps —— 它只数「≥2 条活分支同改一文件」，
  // 而合并官要的是「我要合的这条 vs 别人」，哪怕我这条会话已经退出（工匠干完就走了）也要算
  const changedSet = new Set(changed)
  const byFile = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.alive || r.branch === branch || r.cwd === projectPath) continue
    for (const f of r.files) if (changedSet.has(f)) byFile.set(f, (byFile.get(f) ?? new Set<string>()).add(r.branch))
  }
  const overlaps = [...byFile.entries()]
    .map(([file, b]) => ({ file, branches: [...b].sort() }))
    .sort((a, b) => a.file.localeCompare(b.file))

  const project = projectsSource().find((p) => p.path === projectPath)
  let testCmd: PreflightResult['testCmd'] = { value: null, source: 'none' }
  if (project?.testCmd?.trim()) testCmd = { value: project.testCmd.trim(), source: 'project' }
  else {
    const pkg = path.join(projectPath, 'package.json')
    let pkgText: string | null = null
    try {
      pkgText = fs.existsSync(pkg) ? fs.readFileSync(pkg, 'utf8') : null
    } catch {
      /* 读不了当没有 */
    }
    const inferred = inferTestCmd(pkgText)
    if (inferred) testCmd = { value: inferred, source: 'package.json' }
  }

  return {
    ok: true,
    branch,
    base,
    defaultBranch,
    worktree,
    changed,
    conflicts: parsed.ok ? parsed.conflicts : null,
    ...(conflictNote ? { conflictNote } : {}),
    ...(note ? { note } : {}),
    overlaps,
    testCmd
  }
}

async function graphFor(root: string): Promise<{ graph: CodeGraphResult; cachedAt: number }> {
  const hit = graphCache.get(root)
  if (hit && Date.now() - hit.at < 5 * 60_000) return { graph: hit.graph, cachedAt: hit.at }
  const graph = await analyzeProject(root)
  const at = Date.now()
  graphCache.set(root, { at, graph })
  return { graph, cachedAt: at }
}

function listTestFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.') || ent.name === 'out' || ent.name === 'dist') continue
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p, depth + 1)
      else if (/\.test\.(ts|tsx|mjs|js)$/.test(ent.name)) out.push(path.relative(root, p).split(path.sep).join('/'))
    }
  }
  walk(root, 0)
  return out
}

export async function impact(
  projectPathRaw: string,
  files: string[]
): Promise<({ ok: true; cachedAt: number } & ImpactResult) | Fail> {
  const root = projectRootOf(projectPathRaw)
  const bad = checkRoot(root)
  if (bad) return bad
  const clean = files
    .filter((f): f is string => typeof f === 'string' && !!f && !f.startsWith('/') && !f.includes('..'))
    .map((f) => f.replace(/\\/g, '/'))
  try {
    const { graph, cachedAt } = await graphFor(root)
    return { ok: true, cachedAt, ...impactFrom(graph, clean, listTestFiles(root)) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerMergeHandlers(): void {
  ipcMain.handle('merge:preflight', (_e, p: unknown, b: unknown) =>
    typeof p === 'string' && typeof b === 'string' ? preflight(p, b) : { ok: false, error: '参数不对' }
  )
  ipcMain.handle('merge:impact', (_e, p: unknown, files: unknown) =>
    typeof p === 'string' && Array.isArray(files) ? impact(p, files as string[]) : { ok: false, error: '参数不对' }
  )
}
