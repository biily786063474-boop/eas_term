import { ipcMain, shell } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import type {
  GitStatus,
  GitFileEntry,
  GitDiffResult,
  GitCommit,
  GitCommitFile,
  AiResult,
  OpResult
} from '../shared/types'

// 全部走系统 git CLI（execFile，无 shell）：不引入 nodegit 原生模块，保持跨平台构建干净。
// 路径作为独立参数传入，天然支持含空格的路径（项目常在 /Volumes/biily/... vibe coding/）。

const MAX_BUFFER = 24 * 1024 * 1024 // status/diff 输出上限
const MAX_DIFF_BYTES = 2 * 1024 * 1024 // 单文件 diff 内容上限，超出截断

interface GitRun {
  ok: boolean
  stdout: string
  stderr: string
  code: number
}

function git(cwd: string, args: string[]): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string }) | null
        resolve({
          ok: !err,
          stdout: stdout ?? '',
          stderr: (stderr ?? '') || (e && e.code === 'ENOENT' ? '未找到 git 命令' : ''),
          code: e && typeof e.code === 'number' ? e.code : err ? 1 : 0
        })
      }
    )
  })
}

async function repoRoot(cwd: string): Promise<string | null> {
  if (!cwd) return null
  const r = await git(cwd, ['rev-parse', '--show-toplevel'])
  const root = r.stdout.trim()
  return r.ok && root ? root : null
}

// 解析 `git status --porcelain=v2 --branch -z`
function parseStatus(raw: string): { branch?: string; ahead: number; behind: number; files: GitFileEntry[] } {
  const chunks = raw.split('\0')
  const files: GitFileEntry[] = []
  let branch: string | undefined
  let ahead = 0
  let behind = 0

  for (let i = 0; i < chunks.length; i++) {
    const line = chunks[i]
    if (!line) continue
    const type = line[0]

    if (type === '#') {
      if (line.startsWith('# branch.head ')) {
        const b = line.slice('# branch.head '.length)
        branch = b === '(detached)' ? undefined : b
      } else if (line.startsWith('# branch.ab ')) {
        const m = line.slice('# branch.ab '.length).match(/\+(\d+)\s+-(\d+)/)
        if (m) {
          ahead = Number(m[1])
          behind = Number(m[2])
        }
      }
      continue
    }

    if (type === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const sp = line.split(' ')
      const xy = sp[1] ?? '..'
      const p = sp.slice(8).join(' ')
      files.push(entry(p, xy[0], xy[1], false, false))
    } else if (type === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\0<origPath>
      const sp = line.split(' ')
      const xy = sp[1] ?? '..'
      const p = sp.slice(9).join(' ')
      const origPath = chunks[i + 1] // 重命名/复制的原路径是下一段
      i++
      files.push({ ...entry(p, xy[0], xy[1], false, false), origPath })
    } else if (type === '?') {
      files.push(entry(line.slice(2), '?', '?', true, false))
    } else if (type === 'u') {
      // 未合并（冲突）：u <xy> ... <path>
      const sp = line.split(' ')
      const p = sp.slice(10).join(' ')
      files.push(entry(p, sp[1]?.[0] ?? 'U', sp[1]?.[1] ?? 'U', false, true))
    }
    // '!' ignored 跳过
  }
  return { branch, ahead, behind, files }
}

function entry(
  p: string,
  x: string,
  y: string,
  untracked: boolean,
  conflicted: boolean
): GitFileEntry {
  return {
    path: p,
    x,
    y,
    untracked,
    conflicted,
    staged: !untracked && !conflicted && x !== '.' && x !== ' ',
    unstaged: untracked || conflicted || (y !== '.' && y !== ' ')
  }
}

// `git show <ref>:<relPath>`；ref 为 '' 时取暂存区（stage 0）内容。失败返回 null。
async function showContent(cwd: string, ref: string, relPath: string): Promise<string | null> {
  const r = await git(cwd, ['show', `${ref}:${relPath}`])
  return r.ok ? r.stdout : null
}

function clampBinary(text: string): { text: string; binary: boolean; truncated: boolean } {
  const binary = text.includes('\0')
  if (binary) return { text: '', binary: true, truncated: false }
  if (text.length > MAX_DIFF_BYTES) {
    return { text: text.slice(0, MAX_DIFF_BYTES), binary: false, truncated: true }
  }
  return { text, binary: false, truncated: false }
}

export function registerGitHandlers(): void {
  ipcMain.handle('git:status', async (_e, cwd: string): Promise<GitStatus> => {
    const root = await repoRoot(cwd)
    if (!root) return { isRepo: false, files: [] }
    const r = await git(cwd, ['status', '--porcelain=v2', '--branch', '-z'])
    if (!r.ok) return { isRepo: true, root, files: [], error: r.stderr.trim() }
    const parsed = parseStatus(r.stdout)
    return { isRepo: true, root, ...parsed }
  })

  // mode='worktree'：暂存区(或HEAD) ↔ 工作区磁盘内容；mode='staged'：HEAD ↔ 暂存区
  ipcMain.handle(
    'git:diff',
    async (_e, cwd: string, relPath: string, mode: 'worktree' | 'staged'): Promise<GitDiffResult> => {
      try {
        const root = await repoRoot(cwd)
        if (!root) return { ok: false, original: '', modified: '', binary: false, truncated: false, error: '不是 git 仓库' }

        let originalRaw: string
        let modifiedRaw: string

        if (mode === 'staged') {
          originalRaw = (await showContent(cwd, 'HEAD', relPath)) ?? ''
          modifiedRaw = (await showContent(cwd, '', relPath)) ?? ''
        } else {
          // 基线优先用暂存区内容，其次 HEAD，再无则视为新文件
          originalRaw =
            (await showContent(cwd, '', relPath)) ?? (await showContent(cwd, 'HEAD', relPath)) ?? ''
          // 修改后 = 工作区磁盘内容；文件被删则为空
          try {
            modifiedRaw = await fs.promises.readFile(path.join(root, relPath), 'utf8')
          } catch {
            modifiedRaw = ''
          }
        }

        const o = clampBinary(originalRaw)
        const m = clampBinary(modifiedRaw)
        return {
          ok: true,
          original: o.text,
          modified: m.text,
          binary: o.binary || m.binary,
          truncated: o.truncated || m.truncated
        }
      } catch (err) {
        return {
          ok: false,
          original: '',
          modified: '',
          binary: false,
          truncated: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  ipcMain.handle('git:stage', async (_e, cwd: string, paths: string[]): Promise<OpResult> => {
    const r = await git(cwd, ['add', '--', ...paths])
    return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() }
  })

  ipcMain.handle('git:unstage', async (_e, cwd: string, paths: string[]): Promise<OpResult> => {
    // 有 HEAD 时用 reset 取消暂存；仓库尚无提交时用 rm --cached
    let r = await git(cwd, ['reset', '-q', 'HEAD', '--', ...paths])
    if (!r.ok) r = await git(cwd, ['rm', '-q', '--cached', '--', ...paths])
    return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() }
  })

  // 丢弃改动：已跟踪文件恢复到暂存区版本；未跟踪文件移入废纸篓（可找回，不用 rm）
  ipcMain.handle(
    'git:discard',
    async (_e, cwd: string, paths: string[], untracked: boolean): Promise<OpResult> => {
      if (untracked) {
        const root = await repoRoot(cwd)
        if (!root) return { ok: false, error: '不是 git 仓库' }
        try {
          for (const p of paths) await shell.trashItem(path.join(root, p))
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
      const r = await git(cwd, ['checkout', '--', ...paths])
      return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() }
    }
  )

  ipcMain.handle('git:commit', async (_e, cwd: string, message: string): Promise<OpResult> => {
    const msg = message.trim()
    if (!msg) return { ok: false, error: '请填写提交信息' }
    const r = await git(cwd, ['commit', '-m', msg])
    return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() }
  })

  // 历史版本列表：一次 log + numstat，解析出 hash/时间/信息/文件数
  ipcMain.handle('git:log', async (_e, cwd: string, limit: number): Promise<GitCommit[]> => {
    const root = await repoRoot(cwd)
    if (!root) return []
    // --all + topo-order：纳入所有分支/远程/tag 并保持分支不交错，供画轨道图。
    // %P 父提交（空格分隔）、%D refs。
    const r = await git(cwd, [
      'log',
      `-n${limit || 60}`,
      '--all',
      '--topo-order',
      '--no-color',
      '--pretty=format:%x1e%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s',
      '--numstat'
    ])
    if (!r.ok) return []
    const commits: GitCommit[] = []
    for (const block of r.stdout.split('\x1e')) {
      if (!block.trim()) continue
      const lines = block.split('\n')
      const [hash, parentsStr, refs, author, at, subject] = lines[0].split('\x1f')
      if (!hash) continue
      let files = 0
      for (let i = 1; i < lines.length; i++) if (lines[i].trim()) files++
      commits.push({
        hash,
        parents: parentsStr ? parentsStr.trim().split(' ').filter(Boolean) : [],
        refs: refs ?? '',
        author: author ?? '',
        at: Number(at) || 0,
        subject: subject ?? '',
        files
      })
    }
    return commits
  })

  // 某次提交改动的文件列表（该提交 vs 其父）
  ipcMain.handle(
    'git:commitFiles',
    async (_e, cwd: string, hash: string): Promise<GitCommitFile[]> => {
      const r = await git(cwd, [
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '-r',
        '-z',
        hash
      ])
      if (!r.ok) return []
      const parts = r.stdout.split('\0')
      const files: GitCommitFile[] = []
      for (let i = 0; i < parts.length; i++) {
        const status = parts[i]
        if (!status) continue
        const s = status[0]
        if (s === 'R' || s === 'C') {
          // 重命名/复制：status\0old\0new
          const origPath = parts[++i]
          const path = parts[++i]
          files.push({ path: path ?? '', origPath, status: s })
        } else {
          const path = parts[++i]
          if (path) files.push({ path, status: s })
        }
      }
      return files
    }
  )

  // 某次提交里某文件的 diff（父版本 ↔ 本提交版本）
  ipcMain.handle(
    'git:commitDiff',
    async (_e, cwd: string, hash: string, relPath: string): Promise<GitDiffResult> => {
      try {
        const originalRaw = (await showContent(cwd, `${hash}^`, relPath)) ?? ''
        const modifiedRaw = (await showContent(cwd, hash, relPath)) ?? ''
        const o = clampBinary(originalRaw)
        const m = clampBinary(modifiedRaw)
        return {
          ok: true,
          original: o.text,
          modified: m.text,
          binary: o.binary || m.binary,
          truncated: o.truncated || m.truncated
        }
      } catch (err) {
        return {
          ok: false,
          original: '',
          modified: '',
          binary: false,
          truncated: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  // AI 简述：把某次提交的 diff 交给终端里的 claude CLI 翻成一句人话（复用 Claude Max，无需 key）
  ipcMain.handle('git:describe', async (_e, cwd: string, hash: string): Promise<AiResult> => {
    const show = await git(cwd, ['show', hash, '--stat', '-p', '--no-color'])
    if (!show.ok) return { ok: false, error: show.stderr.trim() || '读取提交失败' }
    let diff = show.stdout
    if (diff.length > 6000) diff = diff.slice(0, 6000)
    const prompt =
      '下面是一次 git 提交的改动，请用一句不超过 30 字的中文口语，直白说明这次改了什么' +
      '（做了什么功能 / 修了什么问题），只输出这一句话，不要任何前缀或解释：\n\n' +
      diff
    return callClaude(cwd, prompt)
  })
}

// 调用终端里已登录的 claude CLI（print 模式，一次性），复用用户的 Claude 订阅
function callClaude(cwd: string, prompt: string): Promise<AiResult> {
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['-p', prompt],
      { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8', timeout: 60000 },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string }) | null
        if (e && e.code === 'ENOENT') {
          resolve({ ok: false, error: '未找到 claude 命令（需安装 Claude Code 并在 PATH 中）' })
          return
        }
        const text = (stdout ?? '').trim()
        if (err && !text) {
          resolve({ ok: false, error: (stderr ?? '').trim() || 'AI 生成失败' })
          return
        }
        // 只取首行，去掉可能的引号/句末标点堆叠
        const line = text.split('\n').find((l) => l.trim()) ?? text
        resolve({ ok: true, text: line.trim().replace(/^["'「』]|["'」』。]$/g, '') })
      }
    )
  })
}
