// 知识库的 git 封装：AI 动用户文件时，这是唯一能**整体**撤销的机制。
//
// 单独成一块是因为它有自己的一套不变量（只认我们打了 [eas] 前缀的提交、
// 回滚前必须先快照当前状态），这些规矩散在 handler 里很容易被下一个人绕过去。
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// ── git：AI 动用户文件时唯一能**整体**撤销的机制 ─────────────────────
//
// 为什么非要它：一次归档会移动若干原件、新建若干笔记、还会改十几篇老笔记的双链。
// 出问题时靠人工逐个还原是不可能的。原文也直说了：
// 「The wiki is just a git repo of markdown files. You get version history … for free.」
//
// 全部走 execFileSync + 参数数组，不拼 shell 字符串——路径里有空格中文都不会出事。
export const MARK = '[eas]' // 我们打的 commit 前缀，回滚列表按它筛

export function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024
  })
}
export function gitOk(root: string, args: string[]): boolean {
  try {
    git(root, args)
    return true
  } catch {
    return false
  }
}
export function isRepo(root: string): boolean {
  return gitOk(root, ['rev-parse', '--git-dir'])
}
/** 工作区有没有未提交的改动 */
export function isDirty(root: string): boolean {
  try {
    return git(root, ['status', '--porcelain']).trim().length > 0
  } catch {
    return true
  }
}

/** 提交当前全部改动。没有改动就返回当前 HEAD（不产生空提交） */
export function commitAll(root: string, message: string): string | null {
  try {
    if (isDirty(root)) {
      git(root, ['add', '-A'])
      git(root, ['commit', '-m', `${MARK} ${message}`, '--no-verify'])
    }
    return git(root, ['rev-parse', 'HEAD']).trim()
  } catch {
    return null
  }
}
