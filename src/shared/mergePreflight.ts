// 合并预检的纯解析。git 调用在 main/mergeTools.ts；这里零依赖、裸测。
export interface WorktreeEntry { path: string; head: string; branch: string | null }

/** `git worktree list --porcelain`：空行分块；`bare` / `locked …` / `prunable …` 这些行忽略。 */
export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = []
  for (const block of porcelain.replace(/\r/g, '').split(/\n\s*\n/)) {
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
 *  第一行树对象，其后到第一个空行是冲突文件名；exit ≥ 2 是 git 本身失败（版本太老等）。
 *  树对象 SHA-1 是 40 位、SHA-256 仓库是 64 位，缩写最短 7 位。
 *  已知取舍：文件名含制表符 / 双引号 / 反斜杠 / 非 ASCII 时，git 会按 core.quotePath 规则
 *  输出 C 风格引号（如 `"a\tb.txt"`），这里**不解引号**，原样当作文件名返回 —— 冲突清单只用来
 *  给人看和粗匹配，不拿它去开文件。 */
export function parseMergeTreeNameOnly(stdout: string, exitCode: number): { ok: true; tree: string; conflicts: string[] } | { ok: false } {
  if (exitCode > 1) return { ok: false }
  const lines = stdout.split('\n')
  const tree = (lines[0] ?? '').trim()
  if (!/^[0-9a-f]{7,64}$/.test(tree)) return { ok: false }
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

/** package.json 有 scripts.test 就推断为 `npm test`（不照抄脚本内容 —— 用户跑的也是这一句）。
 *  `npm init` 默认塞的 `echo "Error: no test specified" && exit 1` 不算有测试。 */
export function inferTestCmd(packageJsonText: string | null): string | null {
  if (!packageJsonText) return null
  try {
    const j = JSON.parse(packageJsonText) as { scripts?: Record<string, string> }
    const t = j.scripts?.test
    if (typeof t !== 'string' || !t.trim()) return null
    if (/no test specified/i.test(t)) return null
    return 'npm test'
  } catch {
    return null
  }
}

/** 工具入参来自模型：分支名只认这几种字符，不以 - 开头（防被当成选项），不含 ..
 *  `@` `^` `~` `:` `{}` 这些 rev 语法一律不认，免得 `main^{tree}` / `main@{1}` 混进来。 */
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
  conflicts: string[] | null           // null = 无法预检
  conflictNote?: string
  /** 项目注册路径不是仓库根（在子目录）时的提示；其余情况没有这个字段 */
  note?: string
  overlaps: { file: string; branches: string[] }[]
  testCmd: { value: string | null; source: 'project' | 'package.json' | 'none' }
}
