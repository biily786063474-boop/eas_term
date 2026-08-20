// 写码 agent 的隔离：每人一个 git worktree。
//
// **这不是加个锁能解决的工程细节，它决定了架构**（方案 E-07）：
// 两个写码 agent 并行改同一个仓库时 —— A 读了 foo.ts，B 也读了，A 写回去，B 也写回去，
// **A 的改动消失，且没有任何人收到报错**。那不是 git 冲突（冲突至少会吵一声），
// 是彻底的静默覆盖。所以第二期只放只读角色，就是为了避开它。
//
// worktree 解决的是**文件层面**的冲突：各写各的工作树，改坏了整个删掉，
// 主工作区一个字没动。它解决不了**语义冲突**（两个人实现了不兼容的接口）——
// 那个要靠派活时把边界划清楚，以及收活时人来看。
//
// 隔离策略只有两种（方案里刻意收窄的）：`worktree`（编程）和 `none`（其余）。
// 只读角色不需要 worktree，直接用主工作区 —— 给它们建一份是纯浪费磁盘。
//
// 纯函数、不引 electron/fs/child_process，node --test 直接跑。

export type Isolation = 'worktree' | 'none'

/** worktree 都放在项目里的这个目录下。**跟着项目走**，删项目就一起没了；
 *  也让 `git worktree list` 看得出它们是同一批东西。 */
export const WORKTREE_DIR = '.worktrees'

/** 批次 id（`b-<毫秒时间戳>`）取后 6 位当短名。
 *  够区分同一天的几批，又不会让路径长到没法看。 */
export function shortBatch(batchId: string): string {
  const digits = batchId.replace(/\D/g, '')
  return digits.slice(-6) || '000000'
}

/** 相对项目根的 worktree 路径。**只拼不解析** —— role 的合法性由 batchSpec 保证
 *  （kebab-case），这里再挡一道是因为它要变成文件路径。 */
export function worktreePath(batchId: string, role: string): string | null {
  if (!/^[a-z0-9-]+$/.test(role)) return null
  return `${WORKTREE_DIR}/${shortBatch(batchId)}-${role}`
}

/** 分支名。带 `eas-team/` 前缀是为了**在 `git branch` 里一眼认出来**，
 *  也避免跟用户自己的分支重名。 */
export function worktreeBranch(batchId: string, role: string): string | null {
  if (!/^[a-z0-9-]+$/.test(role)) return null
  return `eas-team/${shortBatch(batchId)}-${role}`
}

/**
 * 这个角色要不要 worktree。
 *
 * **默认 none。** 隔离是有代价的（一份磁盘、一条分支、收活时还要合），
 * 只有真的写码才值得。派活的人不说，就是不写码。
 */
export function isolationOf(declared: string | undefined): Isolation {
  return declared === 'worktree' ? 'worktree' : 'none'
}

/** 收活时要告诉主 agent 的话。**必须说清楚「改动不在主工作区」** ——
 *  不说的话它会去主工作区找，找不到就以为 agent 什么都没做。 */
export function worktreeHint(role: string, relPath: string, branch: string): string {
  return (
    `\`${role}\` 的改动**不在主工作区**，在 \`${relPath}/\`（分支 \`${branch}\`）。\n` +
    `要看它改了什么：\`git -C ${relPath} diff\` 或 \`git diff ${branch}\`。\n` +
    `**合并前先自己读一遍** —— worktree 只隔离了文件冲突，两个 agent 各自实现出` +
    `不兼容的接口这类语义冲突，它挡不住。`
  )
}
