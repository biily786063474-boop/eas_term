import assert from 'node:assert/strict'
import { test } from 'node:test'

import { newShortId, projectRootOf, roleWorktreeBranch, roleWorktreeName } from './roleWorktree.ts'

test('路径与分支：.worktrees/<roleId>-<id> 与 eas/<roleId>/<id>', () => {
  assert.equal(roleWorktreeName('builder', 'ab12ef'), '.worktrees/builder-ab12ef')
  assert.equal(roleWorktreeBranch('builder', 'ab12ef'), 'eas/builder/ab12ef')
})

test('roleId 不合法（含大写 / 空格 / 路径符）→ null，不拼路径', () => {
  for (const bad of ['Builder', 'a b', '../x', '']) {
    assert.equal(roleWorktreeName(bad, 'ab12ef'), null, bad)
    assert.equal(roleWorktreeBranch(bad, 'ab12ef'), null, bad)
  }
})

test('短 id 是 6 位 [a-z0-9]，可注入随机源', () => {
  const id = newShortId(() => 0.5)
  assert.match(id, /^[a-z0-9]{6}$/)
  assert.match(newShortId(), /^[a-z0-9]{6}$/)
})

test('projectRootOf：worktree 路径回到项目根，其余原样', () => {
  assert.equal(projectRootOf('/p/.worktrees/builder-ab12ef'), '/p')
  assert.equal(projectRootOf('/p/.worktrees/builder-ab12ef/src'), '/p')
  assert.equal(projectRootOf('C:\\p\\.worktrees\\x'), 'C:\\p')
  assert.equal(projectRootOf('/p'), '/p')
})
