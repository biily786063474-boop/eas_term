import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApprovalRegistry } from './approvalRegistry.ts'

const payload = {
  session_id: 's1',
  cwd: '/WORK/proj',
  tool_name: 'Write',
  tool_input: { file_path: '/WORK/proj/a.txt', content: 'hi' },
  tool_use_id: 'toolu_1'
}

test('hook payload 产出 approval.request，approvalId 就是 tool_use_id', () => {
  const r = createApprovalRegistry()
  const req = r.fromHook(payload).find((e) => e.k === 'approval.request')
  assert.ok(req && req.k === 'approval.request')
  assert.equal(req.approvalId, 'toolu_1')
  assert.equal(req.kind, 'patch')
  assert.equal(req.cwd, '/WORK/proj')
  assert.ok(req.title.includes('a.txt'), 'title 要让人看懂动的是哪个文件')
})

test('[2026-08-14 全分支评审] title 精确带"修改"前缀，不只是包含文件名——原断言用 .includes 测不出前缀被删掉', () => {
  const r = createApprovalRegistry()
  const req = r.fromHook(payload).find((e) => e.k === 'approval.request')
  assert.ok(req && req.k === 'approval.request')
  assert.equal(req.title, '修改 a.txt')
})

test('[2026-08-14 全分支评审] detail 是这次调用真实的 tool_input JSON，不是占位符（原测试对 detail 零覆盖，硬编码成固定字符串也能 7/7 全绿）', () => {
  const r = createApprovalRegistry()
  const req = r.fromHook(payload).find((e) => e.k === 'approval.request')
  assert.ok(req && req.k === 'approval.request')
  assert.equal(req.detail, JSON.stringify(payload.tool_input))
  assert.deepEqual(JSON.parse(req.detail), { file_path: '/WORK/proj/a.txt', content: 'hi' })
})

test('[2026-08-14 全分支评审] detail 随 tool_input 变化——不同调用产出不同 detail，不是恒定值', () => {
  const r = createApprovalRegistry()
  const bash = r
    .fromHook({ ...payload, tool_use_id: 't-detail', tool_name: 'Bash', tool_input: { command: 'npm test' } })
    .find((e) => e.k === 'approval.request')
  assert.ok(bash && bash.k === 'approval.request')
  assert.equal(bash.detail, JSON.stringify({ command: 'npm test' }))
})

test('Bash 归 exec，Write/Edit 归 patch，其余归 tool', () => {
  const r = createApprovalRegistry()
  const bash = r
    .fromHook({ ...payload, tool_use_id: 't2', tool_name: 'Bash', tool_input: { command: 'npm test' } })
    .find((e) => e.k === 'approval.request')
  assert.ok(bash && bash.k === 'approval.request' && bash.kind === 'exec')
  assert.ok(bash.k === 'approval.request' && bash.title.includes('npm test'))

  const other = r
    .fromHook({ ...payload, tool_use_id: 't3', tool_name: 'WebFetch', tool_input: {} })
    .find((e) => e.k === 'approval.request')
  assert.ok(other && other.k === 'approval.request' && other.kind === 'tool')
})

test('[2026-08-14 全分支评审] title 精确带"运行"前缀，不只是包含命令文本', () => {
  const r = createApprovalRegistry()
  const bash = r
    .fromHook({ ...payload, tool_use_id: 't2b', tool_name: 'Bash', tool_input: { command: 'npm test' } })
    .find((e) => e.k === 'approval.request')
  assert.ok(bash && bash.k === 'approval.request')
  assert.equal(bash.title, '运行 npm test')
})

test('resolve 产出 approval.resolved 并从待处理表移除', () => {
  const r = createApprovalRegistry()
  r.fromHook(payload)
  assert.equal(r.pendingCount(), 1)
  const evs = r.resolve('toolu_1', 'allow')
  const done = evs.find((e) => e.k === 'approval.resolved')
  assert.ok(done && done.k === 'approval.resolved' && done.decision === 'allow')
  assert.equal(r.pendingCount(), 0)
})

test('同一个 tool_use_id 重复到达不重复计数、不重复产出请求', () => {
  const r = createApprovalRegistry()
  const a = r.fromHook(payload)
  const b = r.fromHook(payload)
  assert.equal(r.pendingCount(), 1)
  assert.equal(a.filter((e) => e.k === 'approval.request').length, 1)
  assert.equal(b.filter((e) => e.k === 'approval.request').length, 0, '第二次不该再弹一张卡片')
})

test('resolve 一个不存在的 id 不抛、不产出事件', () => {
  const r = createApprovalRegistry()
  assert.doesNotThrow(() => r.resolve('没这个id', 'allow'))
  assert.equal(r.resolve('没这个id', 'allow').length, 0)
})

test('缺字段的 payload 不抛异常', () => {
  const r = createApprovalRegistry()
  assert.doesNotThrow(() => r.fromHook({} as never))
})

test('多个待处理审批互不干扰', () => {
  const r = createApprovalRegistry()
  r.fromHook(payload)
  r.fromHook({ ...payload, tool_use_id: 'toolu_2', tool_input: { command: 'ls' }, tool_name: 'Bash' })
  assert.equal(r.pendingCount(), 2)
  r.resolve('toolu_1', 'deny')
  assert.equal(r.pendingCount(), 1, '解决一个不该影响另一个')
})
