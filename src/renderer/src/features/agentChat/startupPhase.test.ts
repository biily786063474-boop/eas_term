import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startupPhaseOf } from './startupPhase.ts'
import type { CliInfo } from '../../../../shared/agentChat.ts'

const cli = (id: string): CliInfo => ({
  id,
  displayName: id,
  available: true,
  capabilities: { contextUsage: true, approval: [] }
})
const base = { clis: null as CliInfo[] | null, selected: null as CliInfo | null, starting: false, startError: null as string | null }

test('还没拉回来 → detecting（不是「拉回来了但是空的」）', () => {
  assert.equal(startupPhaseOf(base).k, 'detecting')
})

test('拉回来了但一个可用的都没有 → none', () => {
  assert.equal(startupPhaseOf({ ...base, clis: [] }).k, 'none')
})

test('有 CLI 且选中了 → ready', () => {
  const c = cli('claude')
  const p = startupPhaseOf({ ...base, clis: [c], selected: c })
  assert.equal(p.k, 'ready')
  assert.equal(p.k === 'ready' && p.selected.id, 'claude')
})

test('**starting 压过 failed** —— 重试时上次的错误还挂着，界面该显示"正在起"', () => {
  const c = cli('claude')
  const p = startupPhaseOf({ clis: [c], selected: c, starting: true, startError: '上次失败了' })
  assert.equal(p.k, 'starting')
})

test('**failed 压过 ready** —— 有错就得让人看见，不能因为选项还在就装作没事', () => {
  const c = cli('claude')
  const p = startupPhaseOf({ clis: [c], selected: c, starting: false, startError: 'spawn 失败' })
  assert.equal(p.k, 'failed')
  assert.equal(p.k === 'failed' && p.error, 'spawn 失败')
})

test('failed 保留 clis/selected —— 用户改一下就能重试，不该被打回探测态', () => {
  const c = cli('claude')
  const p = startupPhaseOf({ clis: [c], selected: c, starting: false, startError: 'x' })
  assert.ok(p.k === 'failed' && p.clis.length === 1 && p.selected.id === 'claude')
})

test('拉回来了但还没选中的一瞬间 → detecting，不是一个选不了 CLI 的空壳', () => {
  assert.equal(startupPhaseOf({ ...base, clis: [cli('claude')] }).k, 'detecting')
})

test('clis 为 null 时即使 starting 为真也是 detecting（不可能状态，但不许崩）', () => {
  assert.equal(startupPhaseOf({ ...base, starting: true }).k, 'detecting')
})
