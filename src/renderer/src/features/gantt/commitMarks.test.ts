import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitMarks, tagsOfRefs } from './commitMarks.ts'
import type { GitCommit } from '../../../../shared/types.ts'

const c = (hash: string, atSec: number, refs = '', subject = 'x'): GitCommit => ({
  hash,
  parents: [],
  refs,
  author: 'me',
  at: atSec,
  subject,
  files: 1
})

test('tagsOfRefs：只取 tag，去掉前缀；分支名不算', () => {
  assert.deepEqual(tagsOfRefs('HEAD -> main, origin/main, tag: v0.4.78, tag: latest'), ['v0.4.78', 'latest'])
  assert.deepEqual(tagsOfRefs('HEAD -> main, origin/main'), [])
  assert.deepEqual(tagsOfRefs(''), [])
})

test('秒换算成毫秒——甘特图全程用毫秒，不换算菱形全跑到轴外', () => {
  const m = commitMarks([c('a', 1000)], 0, 10_000_000)
  assert.equal(m[0].at, 1_000_000)
})

test('时间窗外的不要（边界含）', () => {
  const list = [c('early', 1), c('in', 5), c('late', 9)]
  const m = commitMarks(list, 5000, 5000)
  assert.deepEqual(m.map((x) => x.hash), ['in'])
})

test('按时间升序，不管输入顺序（git log 是倒序的）', () => {
  const m = commitMarks([c('c', 3), c('a', 1), c('b', 2)], 0, 10_000)
  assert.deepEqual(m.map((x) => x.hash), ['a', 'b', 'c'])
})

// 用户定的：版本号不是每个项目都有——没 tag 一样成立
test('**没有任何 tag 的项目：全是普通菱形，一个 isVersion 都没有**', () => {
  const m = commitMarks([c('a', 1, 'HEAD -> main'), c('b', 2, '')], 0, 10_000)
  assert.equal(m.length, 2)
  assert.ok(m.every((x) => !x.isVersion && x.tags.length === 0))
})

test('有 tag 的那枚 isVersion=true，别的不受影响', () => {
  const m = commitMarks([c('a', 1), c('rel', 2, 'tag: v1.0.0'), c('b', 3)], 0, 10_000)
  assert.deepEqual(m.map((x) => x.isVersion), [false, true, false])
  assert.deepEqual(m[1].tags, ['v1.0.0'])
})

test('空输入 → 空数组，不抛', () => {
  assert.deepEqual(commitMarks([], 0, 1), [])
})
