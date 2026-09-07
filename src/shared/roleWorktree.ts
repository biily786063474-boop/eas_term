// 角色会话的 worktree 命名与定位。**纯函数、零依赖。** git 操作在 main/teamWorktreeOps.ts。
//
// 与团队派活的 `.worktrees/<批次>-<role>` / `eas-team/…` 并存：目录同一个，前缀不同，
// `git branch` 里一眼分得清哪些是派活的、哪些是角色会话自己开的。
import { WORKTREE_DIR } from './teamWorktree.ts' // 带 .ts：本文件要在 node --test 下裸跑

const ROLE_RE = /^[a-z][a-z0-9-]*$/

export function roleWorktreeName(roleId: string, id: string): string | null {
  if (!ROLE_RE.test(roleId) || !/^[a-z0-9]{6}$/.test(id)) return null
  return `${WORKTREE_DIR}/${roleId}-${id}`
}

export function roleWorktreeBranch(roleId: string, id: string): string | null {
  if (!ROLE_RE.test(roleId) || !/^[a-z0-9]{6}$/.test(id)) return null
  return `eas/${roleId}/${id}`
}

/** 6 位 [a-z0-9]。随机源可注入，测试才钉得住 */
export function newShortId(rand: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(rand() * alphabet.length) % alphabet.length]
  return s
}

/** 会话 cwd → 项目根：worktree 里的 cwd 剥到 `.worktrees/` 之前；其余原样。两种分隔符都认。 */
export function projectRootOf(cwd: string): string {
  for (const sep of ['/', '\\']) {
    const i = cwd.indexOf(`${sep}${WORKTREE_DIR}${sep}`)
    if (i >= 0) return cwd.slice(0, i)
    if (cwd.endsWith(`${sep}${WORKTREE_DIR}`)) return cwd.slice(0, cwd.length - WORKTREE_DIR.length - 1)
  }
  return cwd
}
