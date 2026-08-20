import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkBatch, MAX_AGENTS } from './batchSpec.ts'

const one = (over = {}) => ({ goal: '重构导出流程', agents: [{ role: 'researcher', task: '调研三种导出格式' }], ...over })

test('正常一批过', () => {
  const r = checkBatch(one())
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.spec.agents[0].role, 'researcher')
})

test('goal 是给用户看的，必填', () => {
  assert.match((checkBatch({ ...one(), goal: '  ' }) as { error: string }).error, /goal 必填/)
})

test('超过上限整批拒绝，并提示分两批', () => {
  const many = Array.from({ length: MAX_AGENTS + 1 }, (_, i) => ({ role: `r${i}`, task: 't' }))
  const r = checkBatch({ ...one(), agents: many }) as { ok: false; error: string }
  assert.equal(r.ok, false)
  assert.match(r.error, /分两批/)
})

test('role 重名要拒 —— 两个同名 agent 会写进同一个目录互相覆盖', () => {
  const r = checkBatch({
    ...one(),
    agents: [{ role: 'dev', task: 'a' }, { role: 'dev', task: 'b' }]
  }) as { ok: false; error: string }
  assert.equal(r.ok, false)
  assert.match(r.error, /重复/)
})

test('role 必须 kebab-case（它同时是目录名）', () => {
  for (const bad of ['Researcher', '调研', '1dev', 'dev_x']) {
    assert.equal(checkBatch({ ...one(), agents: [{ role: bad, task: 't' }] }).ok, false, bad)
  }
  assert.equal(checkBatch({ ...one(), agents: [{ role: 'backend-dev', task: 't' }] }).ok, true)
})

test('没有 task 要拒 —— 派活必须说清干什么', () => {
  const r = checkBatch({ ...one(), agents: [{ role: 'dev', task: '' }] }) as { ok: false; error: string }
  assert.match(r.error, /没有 task/)
})

test('needs / prefer 是可选的，缺了不影响', () => {
  const r = checkBatch(one())
  if (r.ok) {
    assert.equal(r.spec.agents[0].needs, undefined)
    assert.equal(r.spec.agents[0].prefer, undefined)
  }
})

test('estimateTokens 非正数当作没给（不显示一个 0 或负数）', () => {
  const a = checkBatch({ ...one(), estimateTokens: 0 })
  const b = checkBatch({ ...one(), estimateTokens: 50000 })
  if (a.ok) assert.equal(a.spec.estimateTokens, undefined)
  if (b.ok) assert.equal(b.spec.estimateTokens, 50000)
})

test('agents 不是数组 / 空数组都拒', () => {
  assert.equal(checkBatch({ goal: 'g', agents: [] }).ok, false)
  assert.equal(checkBatch({ goal: 'g', agents: 'x' }).ok, false)
  assert.equal(checkBatch(null).ok, false)
})

// ── 隔离方式 ─────────────────────────────────────────────────────

test('只认严格的 worktree，其余一律不隔离', () => {
  const mk = (iso: unknown) =>
    checkBatch({ goal: 'g', agents: [{ role: 'r', task: 't', isolation: iso }] })
  const got = (iso: unknown) => {
    const r = mk(iso)
    return r.ok ? r.spec.agents[0].isolation : 'REJECTED'
  }
  assert.equal(got('worktree'), 'worktree')
  for (const bad of [undefined, 'none', 'Worktree', 'WORKTREE', 'git', 1, true, null]) {
    assert.equal(got(bad), undefined, `${JSON.stringify(bad)} 不该被当成隔离`)
  }
})

test('不隔离时字段干脆不出现，而不是塞一个 undefined', () => {
  const r = checkBatch({ goal: 'g', agents: [{ role: 'r', task: 't' }] })
  assert.ok(r.ok)
  assert.equal('isolation' in r.spec.agents[0], false)
})
