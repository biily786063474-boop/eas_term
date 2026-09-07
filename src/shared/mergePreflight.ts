// 合并预检的纯解析。git 调用在 main/mergeTools.ts；这里零依赖、裸测。
export interface WorktreeEntry { path: string; head: string; branch: string | null }

export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean)
    if (!lines.length) continue
    let path = '', head = '', branch: string | null = null
    for (const l of lines) {
      if (l.startsWith('worktree ')) path = l.slice(9)
      else if (l.startsWith('HEAD ')) head = l.slice(5)
      else if (l.startsWith('branch ')) branch = l.slice(7).replace(/^refs\/heads\//, '')
    }
    if (path) out.push({ path, head, branch })
  }
  return out
}

/** `git merge-tree --write-tree --name-only A B`：exit 0 无冲突（只有树对象）；exit 1 有冲突，
 *  第一行树对象，其后到第一个空行是冲突文件名；exit ≥ 2 是 git 本身失败（版本太老等）。 */
export function parseMergeTreeNameOnly(stdout: string, exitCode: number): { ok: true; tree: string; conflicts: string[] } | { ok: false } {
  if (exitCode > 1) return { ok: false }
  const lines = stdout.split('\n')
  const tree = (lines[0] ?? '').trim()
  if (!/^[0-9a-f]{7,40}$/.test(tree)) return { ok: false }
  if (exitCode === 0) return { ok: true, tree, conflicts: [] }
  const conflicts: string[] = []
  for (const l of lines.slice(1)) {
    if (!l.trim()) break
    conflicts.push(l.trim())
  }
  return { ok: true, tree, conflicts }
}

export function pickDefaultBranch(symbolicRef: string | null, hasMain: boolean, hasMaster: boolean): string | null {
  if (symbolicRef) {
    const m = symbolicRef.trim().match(/^refs\/remotes\/[^/]+\/(.+)$/)
    if (m) return m[1]
  }
  if (hasMain) return 'main'
  if (hasMaster) return 'master'
  return null
}

/** package.json 有 scripts.test 就推断为 `npm test`（不照抄脚本内容 —— 用户跑的也是这一句） */
export function inferTestCmd(packageJsonText: string | null): string | null {
  if (!packageJsonText) return null
  try {
    const j = JSON.parse(packageJsonText) as { scripts?: Record<string, string> }
    return typeof j.scripts?.test === 'string' && j.scripts.test.trim() ? 'npm test' : null
  } catch {
    return null
  }
}

/** 工具入参来自模型：分支名只认这几种字符，不以 - 开头（防被当成选项），不含 .. */
export function isSafeRef(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !name.includes('..')
}

export interface PreflightResult {
  ok: true
  branch: string
  base: string
  defaultBranch: string
  worktree: string | null
  changed: string[]
  conflicts: string[] | null
  conflictNote?: string
  overlaps: { file: string; branches: string[] }[]
  testCmd: { value: string | null; source: 'project' | 'package.json' | 'none' }
}
