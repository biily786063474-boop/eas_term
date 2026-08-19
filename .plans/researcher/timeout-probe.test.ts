// 探针（不是项目测试，产出物，跑完留档）：
// 验证 batchRequest.askForBatch 的 9 分钟超时分支到底会不会执行。
import { test } from 'node:test'
import assert from 'node:assert'
import { askForBatch, __resetBatchState, isBatchRunning } from '../../src/renderer/src/features/team/batchRequest'

const WAIT_MS = 9 * 60 * 1000

test('9 分钟没人点 → askForBatch 应当自己 resolve 成 go:false', async (t) => {
  __resetBatchState()
  t.mock.timers.enable({ apis: ['setTimeout'] })

  let settled: unknown = null
  const p = askForBatch({ spec: { goal: 'x', agents: [] } as never, frameId: 'f1', cwd: '/tmp' })
  p.then((d) => { settled = d })

  t.mock.timers.tick(WAIT_MS + 5000)          // 推过 9 分钟
  await new Promise((r) => setImmediate(r))    // 给 microtask 一拍

  assert.notEqual(settled, null, '超时分支没有执行：Promise 仍然挂着，弹窗不会自己消失')
  assert.deepEqual(settled, { go: false, reason: '清单一直没人处理（等了 9 分钟）' })
})

test('超时之后用户才点「开工」→ running 不该被脏标记', async (t) => {
  __resetBatchState()
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const p = askForBatch({ spec: { goal: 'x', agents: [] } as never, frameId: 'f2', cwd: '/tmp' })
  p.catch(() => {})
  t.mock.timers.tick(WAIT_MS + 5000)
  await new Promise((r) => setImmediate(r))

  const { resolveBatchRequest } = await import('../../src/renderer/src/features/team/batchRequest')
  resolveBatchRequest({ go: true })            // 用户过一会儿才点
  assert.equal(isBatchRunning('f2'), false, 'running 被脏标记了 —— 这个 Frame 之后永远派不了活')
})
