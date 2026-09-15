import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInstallGate, type StagedPlugin } from './pluginInstallGate.ts'

const rec = (over: Partial<StagedPlugin> = {}): StagedPlugin => ({
  name: 'board',
  dir: '/tmp/stage/board-abc',
  version: '1.0.0',
  displayName: '看板',
  permissions: { canvas: ['canvas_open_file'] },
  size: 6421,
  ...over
})

test('stage→consume 拿到同一份记录', () => {
  const gate = createInstallGate()
  const token = gate.stage(rec())
  const got = gate.consume(token)
  assert.equal(got?.name, 'board')
  assert.equal(got?.dir, '/tmp/stage/board-abc')
})

test('一次性:consume 两次,第二次为空', () => {
  const gate = createInstallGate()
  const token = gate.stage(rec())
  assert.ok(gate.consume(token))
  assert.equal(gate.consume(token), undefined)
})

test('无效 token consume 为空', () => {
  const gate = createInstallGate()
  gate.stage(rec())
  assert.equal(gate.consume('nope'), undefined)
})

test('过期后 consume 为空,且 sweep 把它清出来给调用方删目录', () => {
  let t = 1000
  const gate = createInstallGate({ ttlMs: 30_000, now: () => t })
  const token = gate.stage(rec({ dir: '/tmp/stage/board-expired' }))
  t = 1000 + 30_001
  assert.equal(gate.consume(token), undefined) // consume 内部先 sweep,已过期
  // 已被 consume 里的 sweep 清掉,这次 sweep 不再返回
  assert.equal(gate.sweep().length, 0)
})

test('sweep 只清过期的,未过期的留着', () => {
  let t = 0
  const gate = createInstallGate({ ttlMs: 100, now: () => t })
  gate.stage(rec({ name: 'old', dir: '/tmp/old' }))
  t = 50
  const liveToken = gate.stage(rec({ name: 'live', dir: '/tmp/live' }))
  t = 120 // old 过期(0+100<120),live 未过期(50+100=150>120)
  const dead = gate.sweep()
  assert.deepEqual(dead.map((r) => r.name), ['old'])
  assert.equal(gate.peek(liveToken)?.name, 'live')
})

test('peek 不消费,peek 后 consume 仍能拿到', () => {
  const gate = createInstallGate()
  const token = gate.stage(rec())
  assert.equal(gate.peek(token)?.name, 'board')
  assert.equal(gate.consume(token)?.name, 'board') // peek 没消费
})
