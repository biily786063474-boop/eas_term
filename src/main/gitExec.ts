// 跑 git，以及解析 git 输出的纯函数。
//
// **electron-free，node --test 直接裸跑**（同 builtinRoles.ts 的理由：真正用它的
// collabBoard.ts / teamWorktreeOps.ts 都 import electron，测试没法直接 import 它们）。
// 相对 import 一律带 .ts —— 裸跑时 node 不做扩展名补全。
import { execFile } from 'child_process'

export interface GitOut {
  ok: boolean
  out: string
}

/**
 * 跑一条 git。**两个调用方共用这一份**（collabBoard 刷板 / teamWorktreeOps 建树），
 * 之前是逐字重复的两份，改一处必漏一处。
 *
 * 两个全局参数，都不是可选的讲究：
 *
 * · `GIT_OPTIONAL_LOCKS=0` —— **刷板挂在 turn.done 上，而那正是 agent 自己在 commit
 *   的时刻。** `git status` / `git diff` 默认会顺手刷新 index 并为此去拿
 *   `.git/index.lock`，跟 agent 那边的 git 撞上，倒霉的是**它**：
 *   `Unable to create '.git/index.lock': File exists` 当场失败。我们只是后台读一眼，
 *   没有任何理由挡住用户的活。置 0 之后这类**可选**的锁一律不取；必需的锁不受影响，
 *   所以 `worktree add` 这种写操作照常是安全的。
 *
 * · `-c core.quotePath=false` —— 不加的话 git 会把非 ASCII 路径转成八进制转义
 *   （`docs/架构.md` → `docs/\346\236\266\346\236\204.md`）。板上会显示成乱码，
 *   更要命的是 overlap 判定按字符串比对，转义过的和没转义的对不上，**中文路径的
 *   撞车永远判不出来**。本仓库 `docs/architecture/*.md` 必中这条。
 */
export async function gitExec(cwd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<GitOut> {
  const r = await gitExecCode(cwd, args, { timeoutMs: opts.timeoutMs ?? 15_000 })
  const ok = r.code === 0
  return { ok, out: (ok ? r.stdout : r.stderr || r.stdout).trim() }
}

export interface GitCode {
  code: number
  stdout: string
  stderr: string
  /** 被超时掐掉的（execFile 的 killed） */
  killed: boolean
}

/**
 * 带退出码的 git，**上面 `gitExec` 是它的薄包装** —— 环境参数（可选锁不取、路径不转义）只在这一处写。
 *
 * 要退出码的场合：`merge-tree --write-tree` 用退出码区分「0 无冲突 / 1 有冲突 / ≥2 git 自己失败」，
 * 有冲突时 stdout 才是正文，光看 ok 分不清 1 和 2。`rev-parse` 也走它：code 128 且 stderr 为空
 * 是「根本没有 git 命令」，与「不是仓库」要分开说。
 *
 * 超时默认 15s（与 gitExec 一致）；mergeTools 那些可能跑得久的调用自己传 30s。
 * `maxBuffer` 放宽到 16M：merge-tree / diff --name-only 在大仓库上会超过 execFile 默认的 1M。
 */
export function gitExecCode(cwd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<GitCode> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: opts.timeoutMs ?? 15_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown; killed?: boolean }) | null
        const code = e ? (typeof e.code === 'number' ? e.code : 128) : 0
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString(), killed: !!e?.killed })
      }
    )
  })
}

/**
 * git 对含特殊字符的路径会整条加引号并转义（`core.quotePath=false` 只关掉了
 * **非 ASCII** 那部分，引号/反斜杠仍然会被引起来）。不脱引号的话，板上会多出
 * 一对引号，overlap 也就比不上了。
 */
export function unquoteGitPath(p: string): string {
  if (p.length < 2 || !p.startsWith('"') || !p.endsWith('"')) return p
  const body = p.slice(1, -1)
  let out = ''
  for (let i = 0; i < body.length; i++) {
    // 只还原 `\"` 和 `\\` 这类「转义掉的那个字符本身」。
    // `\t` 之流不还原成真正的制表符也没关系：它只是显示，且比错还原安全。
    if (body[i] === '\\' && i + 1 < body.length) {
      out += body[++i]
      continue
    }
    out += body[i]
  }
  return out
}

/**
 * `git status --porcelain` → 路径清单。
 *
 * 每行是 `XY<空格>路径`，所以路径从第 3 个字符起。**重命名/复制那行不一样**：
 * 它是 `R  旧路径 -> 新路径`，直接 `slice(3)` 会得到「旧路径 -> 新路径」这么一个
 * 根本不存在的路径 —— 板上显示成一条假文件，而真正被改的新路径**不在清单里**，
 * 于是两条分支都改了同一个文件也判不出撞车。这里按状态位是不是 R/C 决定要不要
 * 拆箭头，而不是见到 ` -> ` 就拆：一个名字里真带 ` -> ` 的普通文件
 * （` M a -> b`）不能被拆坏。
 */
export function parsePorcelain(text: string): string[] {
  const files: string[] = []
  for (const line of text.split('\n')) {
    if (line.length < 4) continue // 最短也要 `XY p`
    const xy = line.slice(0, 2)
    let rest = line.slice(3)
    if (xy.includes('R') || xy.includes('C')) {
      const i = rest.indexOf(' -> ')
      if (i >= 0) rest = rest.slice(i + 4)
    }
    const p = unquoteGitPath(rest.trim())
    if (p) files.push(p)
  }
  return files
}

/** `git diff --name-only` → 路径清单。一行一个，同样可能被引起来。 */
export function parseNameOnly(text: string): string[] {
  return text
    .split('\n')
    .map((l) => unquoteGitPath(l.trim()))
    .filter(Boolean)
}
