import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  askForBatch, resolveBatchRequest, currentBatchRequest,
  finishBatch, isBatchRunning, __resetBatchState
} from './batchRequest.ts'

const req = (frameId = 'f1') => ({
  frameId, cwd: '/tmp/p',
  spec: { goal: '重构导出', agents: [{ role: 'researcher', task: '调研' }] }
})

test('弹出 → 用户点开工 → 这个 Frame 进入「有批次在跑」', async () => {
  __resetBatchState()
  const p = askForBatch(req())
  assert.equal(currentBatchRequest()?.spec.goal, '重构导出')
  resolveBatchRequest({ go: true })
  assert.deepEqual(await p, { go: true })
  assert.equal(isBatchRunning('f1'), true)
})

test('跑着的时候不许开第二批 —— 两批并行谁也说不清烧了多少', () => {
  __resetBatchState()
  const p = askForBatch(req())
  resolveBatchRequest({ go: true })
  void p
  assert.throws(() => askForBatch(req()), /已经有一批/)
})

test('收尾后放开，可以开下一批', async () => {
  __resetBatchState()
  const p = askForBatch(req()); resolveBatchRequest({ go: true }); await p
  finishBatch('f1')
  assert.equal(isBatchRunning('f1'), false)
  assert.doesNotThrow(() => askForBatch(req()))
})

test('同时只允许一张清单在等', () => {
  __resetBatchState()
  void askForBatch(req())
  assert.throws(() => askForBatch(req('f2')), /在等用户确认/)
})

test('连续取消 2 次 → 这个 Frame 本轮拉黑，且错误信息告诉它该干什么', async () => {
  __resetBatchState()
  for (let i = 0; i < 2; i++) {
    const p = askForBatch(req())
    resolveBatchRequest({ go: false, reason: '不用' })
    await p
  }
  assert.throws(() => askForBatch(req()), /本轮不再弹[\s\S]*单会话/)
})

test('拉黑是按 Frame 的 —— 别的项目不受连累', async () => {
  __resetBatchState()
  for (let i = 0; i < 2; i++) {
    const p = askForBatch(req('f1')); resolveBatchRequest({ go: false }); await p
  }
  assert.doesNotThrow(() => askForBatch(req('f2')))
})

test('中途同意过一次，取消计数清零', async () => {
  __resetBatchState()
  let p = askForBatch(req()); resolveBatchRequest({ go: false }); await p
  p = askForBatch(req()); resolveBatchRequest({ go: true }); await p
  finishBatch('f1')
  p = askForBatch(req()); resolveBatchRequest({ go: false }); await p
  // 只累计了 1 次（中间那次同意清了零），还没到拉黑线
  assert.doesNotThrow(() => askForBatch(req()))
})
