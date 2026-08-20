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

/**
 * 这个会话算不算「这个项目的」。
 *
 * **隔离的 agent cwd 在 `<项目>/.worktrees/…` 下，不等于项目根** —— 用
 * `cwd === projectPath` 去过滤会把它们全滤掉。2026-08-20 真机撞到：派了
 * reader（只读）和 writer（worktree）两个，`team_status` 只报得出 reader，
 * writer 的工作树建好了、文件也写了，却在面板和所有 team_* 工具里凭空消失 ——
 * **等于一个没人管得着、还在烧钱的进程**，正是纪律第 4 条要防的那种。
 */
export function belongsToProject(sessionCwd: string, projectPath: string): boolean {
  if (!sessionCwd || !projectPath) return false
  if (sessionCwd === projectPath) return true
  // 只认我们自己建的那层，不是「凡是子目录都算」——
  // 用户在项目里另开一个 AI 对话、cwd 指向某个子目录，那不属于这一批
  //
  // **两种分隔符都认**：Windows 上 git 报的工作树路径带反斜杠，
  // 只判 `/` 的话这个函数在那边等于恒假 —— 而它现在管着「隔离 agent 算不算这个项目」，
  // 恒假意味着所有 team_* 工具和面板都看不见隔离 agent（.plans/silent-fail S-14）。
  const head = `${projectPath}/${WORKTREE_DIR}/`
  if (sessionCwd.startsWith(head)) return true
  const win = `${projectPath}\\${WORKTREE_DIR}\\`
  return sessionCwd.startsWith(win)
}
