import test from 'node:test'
import assert from 'node:assert/strict'
import { createArtifactRefreshGate } from './artifactRefresh.ts'

test('干净编辑态也延迟刷新，保存但仍编辑时不刷新，退出后仅刷新一次', () => {
  let refreshed = 0
  const gate = createArtifactRefreshGate(() => refreshed++)
  gate.setEditing(true)
  gate.request()
  gate.request()
  assert.equal(refreshed, 0)
  gate.setDirty(true)
  gate.setDirty(false)
  assert.equal(refreshed, 0)
  gate.setEditing(false)
  assert.equal(refreshed, 1)
  gate.request()
  assert.equal(refreshed, 2)
})
test('编辑退出但仍有脏草稿时继续保护', () => {
  let refreshed = 0
  const gate = createArtifactRefreshGate(() => refreshed++)
  gate.setDirty(true)
  gate.request()
  gate.setEditing(false)
  assert.equal(refreshed, 0)
  gate.setDirty(false)
  assert.equal(refreshed, 1)
})
