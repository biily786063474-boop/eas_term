import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAcpApprovals, ACP_APPROVAL_TIMEOUT_MS } from './approvals.ts'
import type { ApprovalAsk } from '../ompEvents.ts'

const ask = (approvalId: string, rpcId: number | string = 0): ApprovalAsk => ({
  approvalId,
  rpcId,
  kind: 'exec',
  title: 'ls',
  detail: 'ls -la'
})

// ── 主路径：等用户 ────────────────────────────────────────────────────────

test('决定要等用户点 —— 点之前 Promise 不 settle，点了拿到的就是他点的那个', async () => {
  const a = createAcpApprovals()
  const p = a.decide(ask('x1'))
  let done = false
  void p.then(() => {
    done = true
  })
  await Promise.resolve()
  assert.equal(done, false)
  assert.equal(a.pendingCount(), 1)
  assert.equal(a.resolve('x1', 'allow'), true)
  assert.equal(await p, 'allow')
  assert.equal(a.pendingCount(), 0, '决定作出就销条目，不等第二条通道')
})

test('**陌生 id 返回 false 且不抛** —— resolveApproval 靠这个返回值决定是不是我这条路的', () => {
  // session.ts 那处是 `resolveApprovalGlobal(...) || resolveAcpApproval(...)`：
  // 这里抛异常会把 hook 那条路的 IPC 一起带崩。
  const a = createAcpApprovals()
  for (const bad of [undefined, null, '', 42, {}, 'never-seen']) {
    assert.equal(a.resolve(bad, 'allow'), false)
  }
})

test('认不出的决定值一律当 deny —— 渲染层传来的是原始值，猜错方向就是替用户放行', async () => {
  const a = createAcpApprovals()
  for (const v of ['ALLOW', 'yes', true, 1, undefined, null]) {
    const id = `v-${String(v)}`
    const p = a.decide(ask(id))
    a.resolve(id, v)
    assert.equal(await p, 'deny', `"${String(v)}" 不该被当成放行`)
  }
})

test('缺 approvalId 的请求立刻 deny，**不进表** —— 它没法被 resolve，登记了只会等到超时', async () => {
  const a = createAcpApprovals()
  assert.equal(await a.decide({ ...ask('x'), approvalId: '' }), 'deny')
  assert.equal(await a.decide({ ...ask('x'), approvalId: undefined as unknown as string }), 'deny')
  assert.equal(a.pendingCount(), 0)
})

// ── 三个出口，每个条目必定 settle 一次、且只一次 ──────────────────────────

test('等不到就兜底 deny —— **不能永远挂着**，那边 session/prompt 在干等', async () => {
  // omp 侧对两条通道都是无限等（acp-client-bridge.ts:114-152 没有 timer、
  // wrapper.ts:331 不传 dialogOptions），这一刀只能由我们来切。
  const a = createAcpApprovals({ timeoutMs: 1 })
  assert.equal(await a.decide(ask('t1')), 'deny')
  assert.equal(a.pendingCount(), 0)
})

test('abortAll 把每个未决的都按 deny 落地，并报出是哪几张卡', async () => {
  const a = createAcpApprovals()
  const p1 = a.decide(ask('a1'))
  const p2 = a.decide(ask('a2'))
  assert.deepEqual(a.abortAll(), ['a1', 'a2'])
  assert.deepEqual(await Promise.all([p1, p2]), ['deny', 'deny'])
  assert.equal(a.pendingCount(), 0)
  assert.deepEqual(a.abortAll(), [], '再来一次是空操作')
})

test('**每个条目只 settle 一次**：点过之后超时与 abort 都不再动它', async () => {
  // 多 settle 一次的后果是 reduce.ts:126 那个单槽 pending 被清两遍，
  // 第二次清掉的是**下一张**卡片。
  const settled: string[] = []
  const a = createAcpApprovals({ timeoutMs: 5, onSettled: (id, d) => settled.push(`${id}:${d}`) })
  const p = a.decide(ask('once'))
  assert.equal(a.resolve('once', 'allow'), true)
  assert.equal(a.resolve('once', 'deny'), false, '第二次点击不该再 settle 一遍')
  assert.deepEqual(a.abortAll(), [])
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(await p, 'allow', '超时定时器必须已经被 clear，不许把已定的决定改掉')
  assert.deepEqual(settled, ['once:allow'])
})

test('同一张卡片重复登记不开第二个等待者 —— 用户点一次，两边都放行', async () => {
  const a = createAcpApprovals()
  const p1 = a.decide(ask('dup'))
  const p2 = a.decide(ask('dup'))
  assert.equal(a.pendingCount(), 1)
  a.resolve('dup', 'allow')
  assert.deepEqual(await Promise.all([p1, p2]), ['allow', 'allow'])
})

// ── 定时器卫生 ───────────────────────────────────────────────────────────

test('默认那个 5 分钟定时器必须 unref —— 否则本文件跑完要等五分钟才退出', () => {
  // **这条测试的断言就是「这个进程能正常退出」**：下面故意留一个用默认超时的待决条目，
  // 定时器没 unref 的话 node --test 会一直等它到期。
  const a = createAcpApprovals()
  void a.decide(ask('leaky'))
  assert.equal(a.pendingCount(), 1)
  assert.equal(ACP_APPROVAL_TIMEOUT_MS, 5 * 60 * 1000, '与 approvalRoute 的同名值保持一致')
})
