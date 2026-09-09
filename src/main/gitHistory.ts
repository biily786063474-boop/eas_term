import { gitExec } from './gitExec.ts'
import type { GitCommitFile } from '../shared/types.ts'

async function run(cwd: string, args: string[]): Promise<string> {
  const result = await gitExec(cwd, args)
  if (!result.ok) throw new Error(result.out.trim() || 'Git 操作失败')
  return result.out
}
async function commit(cwd: string, value: string): Promise<string> {
  if (typeof value !== 'string' || !/^(?:HEAD|[a-fA-F0-9]{7,64})$/.test(value)) throw new Error('非法提交编号')
  return (await run(cwd, ['rev-parse', '--verify', `${value}^{commit}`])).trim()
}
export type HistoryAction = 'checkout' | 'switch' | 'branch' | 'tag'
export async function historyAction(cwd: string, action: HistoryAction, target: string, name?: string): Promise<void> {
  if (!['checkout', 'switch', 'branch', 'tag'].includes(action)) throw new Error('未知操作')
  if (action !== 'tag' && (await run(cwd, ['status', '--porcelain', '--untracked-files=all'])).trim()) {
    throw new Error('当前有未提交改动，请先提交或 stash；不会强制覆盖文件。')
  }
  if (action === 'switch') {
    if (typeof target !== 'string' || target.startsWith('-')) throw new Error('非法分支名')
    await run(cwd, ['check-ref-format', `refs/heads/${target}`])
    await run(cwd, ['show-ref', '--verify', `refs/heads/${target}`])
    await run(cwd, ['checkout', target, '--'])
    return
  }
  const hash = await commit(cwd, target)
  if (action === 'checkout') { await run(cwd, ['checkout', '--detach', hash]); return }
  if (!name || name.startsWith('-') || name !== name.trim()) throw new Error('请输入有效名称')
  await run(cwd, ['check-ref-format', `${action === 'tag' ? 'refs/tags' : 'refs/heads'}/${name}`])
  await run(cwd, action === 'tag' ? ['tag', name, hash] : ['checkout', '-b', name, hash])
}

export async function historyFiles(cwd: string, base: string | undefined, target: string): Promise<GitCommitFile[]> {
  const hash = await commit(cwd, target)
  let before: string | undefined
  if (base) before = await commit(cwd, base)
  else {
    const parent = await gitExec(cwd, ['rev-parse', '--verify', `${hash}^`])
    if (parent.ok) before = parent.out.trim()
  }
  const args = (flag: string) => before
    ? ['diff', '--no-ext-diff', '-M', flag, '-z', before, hash, '--']
    : ['diff-tree', '--no-commit-id', '--root', '-r', '-M', flag, '-z', hash, '--']
  const parts = (await run(cwd, args('--name-status'))).split('\0')
  const files: GitCommitFile[] = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i++]?.[0]
    if (!status) continue
    const old = parts[i++]
    const renamed = status === 'R' || status === 'C'
    const file = renamed ? parts[i++] : old
    if (file) files.push({ path: file, status, ...(renamed ? { origPath: old } : {}) })
  }
  const stats = (await run(cwd, args('--numstat'))).split('\0')
  for (let i = 0; i < stats.length; i++) {
    const entry = stats[i]; if (!entry) continue
    const one = entry.indexOf('\t'), two = entry.indexOf('\t', one + 1)
    const added = entry.slice(0, one), deleted = entry.slice(one + 1, two)
    let name = entry.slice(two + 1)
    if (!name) { i++; name = stats[++i] }
    const file = files.find(f => f.path === name)
    if (file) { file.added = added === '-' ? null : Number(added); file.deleted = deleted === '-' ? null : Number(deleted) }
  }
  return files
}
