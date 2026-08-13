import { test } from 'node:test'
import assert from 'node:assert'
import { encodeCwd, candidateDirs } from './sessionPaths.ts'

const ROOT = '/Users/me/.claude/projects'

test('encodeCwd：非字母数字一律换成短横线（照抄 Claude Code 的约定）', () => {
  assert.strictEqual(encodeCwd('/Users/me/Projects/foo'), '-Users-me-Projects-foo')
  assert.strictEqual(encodeCwd('/Users/me/vibe coding/terminal'), '-Users-me-vibe-coding-terminal')
  assert.strictEqual(encodeCwd('/a/b_c.d'), '-a-b-c-d')
})

test('没有旧路径时只有一个候选', () => {
  assert.deepStrictEqual(candidateDirs(ROOT, '/Users/me/foo'), [
    '/Users/me/.claude/projects/-Users-me-foo'
  ])
})

test('有旧路径时当前的排第一、旧的按给的顺序跟在后面', () => {
  const got = candidateDirs(ROOT, '/Users/me/new', ['/Users/me/old', '/Users/me/older'])
  assert.deepStrictEqual(got, [
    '/Users/me/.claude/projects/-Users-me-new',
    '/Users/me/.claude/projects/-Users-me-old',
    '/Users/me/.claude/projects/-Users-me-older'
  ])
})

test('旧路径编码后和当前撞了就不重复列（改回原名的情况）', () => {
  const got = candidateDirs(ROOT, '/Users/me/foo', ['/Users/me/foo', '/Users/me/bar'])
  assert.deepStrictEqual(got, [
    '/Users/me/.claude/projects/-Users-me-foo',
    '/Users/me/.claude/projects/-Users-me-bar'
  ])
})

test('空的/非法的旧路径条目直接跳过，不产生垃圾候选', () => {
  const got = candidateDirs(ROOT, '/Users/me/foo', ['', '   '] as string[])
  assert.deepStrictEqual(got, ['/Users/me/.claude/projects/-Users-me-foo'])
})
