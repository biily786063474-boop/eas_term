// cwd → Claude Code 存 transcript 的目录名。
//
// **不引 electron**：这样 node --test 能直接加载它。session.ts 引了 electron，
// 判定逻辑留在那边就测不住，而这条错了整个项目的历史会话会一起消失。
import path from 'path'

/** Claude Code 把 cwd 里的非字母数字全换成 '-' 当目录名。照抄它的约定，不要自己发挥。 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * 这个 cwd 的 transcript 可能落在哪些目录里，当前路径排第一。
 *
 * 为什么要有「旧路径」：项目文件夹一改名，编码目录名就变了，改名前的会话留在老目录里。
 * 我们**不搬 Claude Code 的目录**（那是别人的地盘，而且它可能正开着在写），
 * 改成读的时候新旧一起找 —— 对用户来说改名前后无缝。
 */
export function candidateDirs(
  claudeProjectsRoot: string,
  cwd: string,
  pastPaths?: string[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (p: string): void => {
    if (!p || !p.trim()) return
    const enc = encodeCwd(p)
    if (seen.has(enc)) return
    seen.add(enc)
    out.push(path.join(claudeProjectsRoot, enc))
  }
  push(cwd)
  for (const p of pastPaths ?? []) push(p)
  return out
}
