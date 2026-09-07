import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inferTestCmd, isSafeRef, parseMergeTreeNameOnly, parseWorktreeList, pickDefaultBranch } from './mergePreflight.ts'

test('parseWorktreeList：按块解析，主工作区 branch 为 refs 去前缀，detached 为 null', () => {
  const out = `worktree /p\nHEAD aaaa\nbranch refs/heads/main\n\nworktree /p/.worktrees/builder-t1\nHEAD bbbb\nbranch refs/heads/eas/builder/t1\n\nworktree /p/.worktrees/x\nHEAD cccc\ndetached\n\n`
  assert.deepEqual(parseWorktreeList(out), [
    { path: '/p', head: 'aaaa', branch: 'main' },
    { path: '/p/.worktrees/builder-t1', head: 'bbbb', branch: 'eas/builder/t1' },
    { path: '/p/.worktrees/x', head: 'cccc', branch: null }
  ])
})

test('parseWorktreeList：CRLF 输出（Windows git）结果与 LF 一致', () => {
  const out = `worktree C:/p\r\nHEAD aaaa\r\nbranch refs/heads/main\r\n\r\nworktree C:/p/.worktrees/x\r\nHEAD cccc\r\ndetached\r\n\r\n`
  assert.deepEqual(parseWorktreeList(out), [
    { path: 'C:/p', head: 'aaaa', branch: 'main' },
    { path: 'C:/p/.worktrees/x', head: 'cccc', branch: null }
  ])
})

test('parseWorktreeList：bare / locked / prunable 行忽略，块照常解析', () => {
  const out = `worktree /bare.git\nbare\n\nworktree /p/.worktrees/l\nHEAD dddd\nbranch refs/heads/l\nlocked reason with spaces\n\nworktree /p/.worktrees/gone\nHEAD eeee\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location\n\n`
  assert.deepEqual(parseWorktreeList(out), [
    { path: '/bare.git', head: '', branch: null },
    { path: '/p/.worktrees/l', head: 'dddd', branch: 'l' },
    { path: '/p/.worktrees/gone', head: 'eeee', branch: 'gone' }
  ])
})

test('parseMergeTreeNameOnly：有冲突 → exit 1，第一行树对象，其后到空行为止是冲突文件', () => {
  const out = `ebfbfc12\nf.txt\nsrc/a.ts\n\nAuto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\n`
  assert.deepEqual(parseMergeTreeNameOnly(out, 1), { ok: true, tree: 'ebfbfc12', conflicts: ['f.txt', 'src/a.ts'] })
})

test('parseMergeTreeNameOnly：无冲突 → exit 0 只有树对象', () => {
  assert.deepEqual(parseMergeTreeNameOnly('b90cedd\n', 0), { ok: true, tree: 'b90cedd', conflicts: [] })
})

test('parseMergeTreeNameOnly：SHA-256 仓库的 64 位树对象也认', () => {
  const tree = 'a'.repeat(64)
  assert.deepEqual(parseMergeTreeNameOnly(`${tree}\n`, 0), { ok: true, tree, conflicts: [] })
})

test('parseMergeTreeNameOnly：exit ≥ 2 或输出为空 → 不可预检', () => {
  assert.deepEqual(parseMergeTreeNameOnly('', 128), { ok: false })
  assert.deepEqual(parseMergeTreeNameOnly('fatal: bad', 2), { ok: false })
})

test('parseMergeTreeNameOnly：exit 1 但首行不是树对象（空 / fatal）→ 不可预检', () => {
  assert.deepEqual(parseMergeTreeNameOnly('', 1), { ok: false })
  assert.deepEqual(parseMergeTreeNameOnly('fatal: x', 1), { ok: false })
})

test('pickDefaultBranch：origin/HEAD 优先，其次 main，再 master，都没有 null', () => {
  assert.equal(pickDefaultBranch('refs/remotes/origin/develop', true, true), 'develop')
  assert.equal(pickDefaultBranch(null, true, true), 'main')
  assert.equal(pickDefaultBranch(null, false, true), 'master')
  assert.equal(pickDefaultBranch(null, false, false), null)
})

test('inferTestCmd：读 scripts.test；没有或坏 JSON → null', () => {
  assert.equal(inferTestCmd(JSON.stringify({ scripts: { test: 'node --test' } })), 'npm test')
  assert.equal(inferTestCmd(JSON.stringify({ scripts: {} })), null)
  assert.equal(inferTestCmd('{bad'), null)
  assert.equal(inferTestCmd(null), null)
})

test('inferTestCmd：npm init 默认的 "no test specified" 占位脚本不算有测试', () => {
  assert.equal(inferTestCmd(JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })), null)
})

test('isSafeRef：只认字母数字 ._/-，不以 - 开头，不含 ..', () => {
  assert.ok(isSafeRef('eas/builder/ab12ef'))
  assert.ok(isSafeRef('main'))
  for (const bad of ['-x', 'a b', 'a..b', 'a;b', '', 'a\nb']) assert.ok(!isSafeRef(bad), bad)
})

test('isSafeRef：放行 HEAD 与全名 ref；拒绝 rev 语法（@ ^{} ~ : @{}）', () => {
  assert.ok(isSafeRef('HEAD'))
  assert.ok(isSafeRef('refs/heads/x'))
  for (const bad of ['@', 'main^{tree}', 'main~1', 'a:b', 'main@{1}']) assert.ok(!isSafeRef(bad), bad)
})
