// git worktree 的实际操作。判定与命名在 shared/teamWorktree.ts，这里只跑 git。
//
// **写码 agent 的隔离靠它成立**：每人一棵独立工作树，改坏了整个删掉，
// 主工作区一个字没动（方案 E-07）。
//
// 三条不能省的前置检查，每条对应一种「看起来成功、其实白干」的失败：
//   · 不是 git 仓库 → worktree 根本建不了，而 agent 会照样开始写，写完发现无处可合
//   · 分支已存在 → `git worktree add -b` 直接失败，但错误信息是 git 的英文，
//     不解释成人话的话，用户只会看到派活失败而不知道为什么
//   · 目标目录已存在 → 同上，且可能是上一批留下的残骸

import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (err ? stderr || stdout : stdout).toString().trim() })
    })
  })
}

export interface WorktreeResult {
  ok: boolean
  /** 绝对路径，给 agentChat 当 cwd 用 */
  absPath?: string
  branch?: string
  error?: string
}

export function registerTeamWorktree(): void {
  ipcMain.handle(
    'team:worktreeAdd',
    async (_e, projectPath: unknown, relPath: unknown, branch: unknown): Promise<WorktreeResult> => {
      if (typeof projectPath !== 'string' || typeof relPath !== 'string' || typeof branch !== 'string')
        return { ok: false, error: '参数不对' }

      const inside = await git(projectPath, ['rev-parse', '--is-inside-work-tree'])
      if (!inside.ok || inside.out !== 'true')
        return {
          ok: false,
          // 说清楚**为什么**不行、以及怎么绕过去 —— 光说「不是 git 仓库」的话，
          // 主 agent 多半会直接放弃整个任务，而它其实可以退回不隔离的方式派
          error:
            '这个项目不是 git 仓库，起不了 worktree。写码 agent 必须隔离（并发写会静默覆盖），' +
            '所以要么先 git init，要么这一批改成只读角色。'
        }

      const abs = path.join(projectPath, relPath)
      if (fs.existsSync(abs))
        return { ok: false, error: `${relPath} 已经存在 —— 可能是上一批留下的，先删掉再派` }

      const exists = await git(projectPath, ['rev-parse', '--verify', branch])
      if (exists.ok) return { ok: false, error: `分支 ${branch} 已存在，先删掉再派` }

      const r = await git(projectPath, ['worktree', 'add', '-b', branch, relPath])
      if (!r.ok) return { ok: false, error: `git worktree add 失败：${r.out.slice(0, 200)}` }
      return { ok: true, absPath: abs, branch }
    }
  )

  ipcMain.handle(
    'team:worktreeRemove',
    async (
      _e,
      projectPath: unknown,
      relPath: unknown,
      branch: unknown,
      force: unknown
    ): Promise<{ ok: boolean; error?: string; changed?: number }> => {
      if (typeof projectPath !== 'string' || typeof relPath !== 'string') return { ok: false, error: '参数不对' }
      const abs = path.join(projectPath, relPath)

      // **有未提交改动就拒绝删。**
      //
      // 我一开始写的是无条件 `--force`，注释里说「改动已经在分支上，没丢」——
      // **那句是错的**：分支只指向建树时的 HEAD，agent 干完活多半根本没 commit，
      // 所以 --force 抹掉的是它这一趟全部的成果。2026-08-19 真机验证时才看清：
      // 树删掉之后分支还在，但 `git log` 上一个新提交都没有。
      //
      // 派活失败时的清理不受影响 —— 那时树是刚建的、一个改动都没有。
      if (force !== true && fs.existsSync(abs)) {
        const st = await git(abs, ['status', '--porcelain'])
        const changed = st.ok ? st.out.split('\n').filter(Boolean).length : 0
        if (changed > 0)
          return {
            ok: false,
            changed,
            error:
              `\`${relPath}\` 里还有 ${changed} 处未提交的改动，没有删。` +
              `先看一眼（\`git -C ${relPath} diff\`）——要它就在那边 commit 或者合过来，` +
              `确定不要了再带 force 删。`
          }
      }

      const r = await git(projectPath, ['worktree', 'remove', '--force', relPath])
      if (!r.ok && !r.out.includes('is not a working tree'))
        return { ok: false, error: r.out.slice(0, 200) }
      // 分支留着 —— **删工作树不等于扔掉成果**（提交过的话）。
      // 想清干净用 `git branch -D <branch>`，那是人的决定不是我们的。
      void branch
      return { ok: true }
    }
  )

  /** 这一批的 worktree 里有没有改动。收活时要报给主 agent —— 
   *  「跑完了」和「改了东西」是两件事，一个 agent 可能什么都没动。 */
  ipcMain.handle(
    'team:worktreeStat',
    async (_e, projectPath: unknown, relPath: unknown): Promise<{ exists: boolean; changed: number }> => {
      if (typeof projectPath !== 'string' || typeof relPath !== 'string') return { exists: false, changed: 0 }
      const abs = path.join(projectPath, relPath)
      if (!fs.existsSync(abs)) return { exists: false, changed: 0 }
      const r = await git(abs, ['status', '--porcelain'])
      return { exists: true, changed: r.ok ? r.out.split('\n').filter(Boolean).length : 0 }
    }
  )
}
