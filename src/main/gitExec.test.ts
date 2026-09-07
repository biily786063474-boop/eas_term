// gitExec.ts 裸测（node --test 直接跑，不经 electron）。
//
// 主要钉 `gitExecCode` 的退出码语义：mergeTools 靠 code 区分「1 有冲突 / ≥2 git 失败」，
// `gitExec` 又是它的薄包装 —— 这层要是把 code 和 stdout/stderr 搞混，上面两处都会静默给出假结论。
// 用一座临时仓库跑真 git，不 mock execFile：mock 出来的退出码只是在验证自己。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { gitExec, gitExecCode } from './gitExec.ts'

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-gitexec-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  git('init', '-q', '-b', 'main')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}

test('gitExecCode：rev-parse --verify -q 不存在的分支 → code 1、stdout 为空', async () => {
  const dir = tmpRepo()
  const r = await gitExecCode(dir, ['rev-parse', '--verify', '-q', 'refs/heads/nope'])
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.equal(r.killed, false)
})

test('gitExecCode：merge-base 不存在的 ref → code 128 且 stderr 非空', async () => {
  const dir = tmpRepo()
  const r = await gitExecCode(dir, ['merge-base', 'refs/heads/main', 'refs/heads/nope'])
  assert.equal(r.code, 128)
  assert.ok(r.stderr.trim().length > 0)
  assert.equal(r.killed, false)
})

test('gitExecCode：成功时 code 0，stdout 原样（不 trim）', async () => {
  const dir = tmpRepo()
  const r = await gitExecCode(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  assert.equal(r.code, 0)
  assert.equal(r.stdout, 'main\n')
  assert.equal(r.stderr, '')
})

test('gitExec 是 gitExecCode 的薄包装：ok = code===0；失败时 out 取 stderr（空则退回 stdout），都 trim', async () => {
  const dir = tmpRepo()
  const good = await gitExec(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  assert.deepEqual(good, { ok: true, out: 'main' })

  // code 1、stderr 空、stdout 空 → out 为空串（mergeTools 靠「!ok 且 out 为空」判 unrelated histories）
  const quiet = await gitExec(dir, ['rev-parse', '--verify', '-q', 'refs/heads/nope'])
  assert.deepEqual(quiet, { ok: false, out: '' })

  const loud = await gitExec(dir, ['merge-base', 'refs/heads/main', 'refs/heads/nope'])
  assert.equal(loud.ok, false)
  assert.ok(loud.out.length > 0)
})

test('gitExecCode：不是仓库的目录 → code 128、stderr 非空（与「没有 git 命令」的空 stderr 区分）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-gitexec-norepo-'))
  const r = await gitExecCode(dir, ['rev-parse', '--show-toplevel'])
  assert.equal(r.code, 128)
  assert.ok(r.stderr.trim().length > 0)
})
