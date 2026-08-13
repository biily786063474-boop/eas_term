import { test } from 'node:test'
import assert from 'node:assert'
import { planRename } from './projectPaths.ts'

const base = [
  { id: 'a', name: 'terminal', path: '/Users/me/Projects/terminal' },
  { id: 'b', name: '我的画板', path: '/Users/me/Projects/canvas' }
]
const run = (over: Partial<Parameters<typeof planRename>[0]> = {}) =>
  planRename({ projects: base, projectId: 'a', newName: 'eas-term', ...over })

test('正常改名：算出新路径，留在同一个父目录里', () => {
  const r = run()
  assert.strictEqual(r.ok, true)
  if (!r.ok) return
  assert.strictEqual(r.oldPath, '/Users/me/Projects/terminal')
  assert.strictEqual(r.newPath, '/Users/me/Projects/eas-term')
})

test('没自定义过展示名（name === 目录名）→ 展示名跟着改', () => {
  const r = run()
  assert.strictEqual(r.ok && r.renameDisplayName, true)
})

test('自定义过展示名 → 不动它，只改路径', () => {
  const r = planRename({ projects: base, projectId: 'b', newName: 'board' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.ok && r.renameDisplayName, false)
})

test('项目不存在 → 拒绝', () => {
  assert.strictEqual(planRename({ projects: base, projectId: 'zzz', newName: 'x' }).ok, false)
})

test('名字含斜杠 → 拒绝（借机移动位置是不允许的）', () => {
  const r = run({ newName: '../evil' })
  assert.strictEqual(r.ok, false)
  assert.match(r.ok ? '' : r.error, /斜杠|名称/)
})

test('名字以点开头 → 拒绝（会变成隐藏目录）', () => {
  assert.strictEqual(run({ newName: '.hidden' }).ok, false)
})

test('名字为空或全空白 → 拒绝', () => {
  assert.strictEqual(run({ newName: '   ' }).ok, false)
})

test('新名字和现在一样 → 拒绝（没有要做的事，别走一遍写盘）', () => {
  assert.strictEqual(run({ newName: 'terminal' }).ok, false)
})

test('知识库正好在这个项目里 → 拒绝，并说清原因', () => {
  const r = run({ wikiPath: '/Users/me/Projects/terminal/wiki' })
  assert.strictEqual(r.ok, false)
  assert.match(r.ok ? '' : r.error, /知识库/)
})

test('知识库在别处 → 不受影响', () => {
  assert.strictEqual(run({ wikiPath: '/Users/me/Documents/eas-wiki' }).ok, true)
})

test('知识库路径恰好等于项目根 → 也要拒绝', () => {
  assert.strictEqual(run({ wikiPath: '/Users/me/Projects/terminal' }).ok, false)
})

test('新路径会撞上另一个已注册项目 → 拒绝', () => {
  const r = planRename({
    projects: [...base, { id: 'c', name: 'eas-term', path: '/Users/me/Projects/eas-term' }],
    projectId: 'a',
    newName: 'eas-term'
  })
  assert.strictEqual(r.ok, false)
})
