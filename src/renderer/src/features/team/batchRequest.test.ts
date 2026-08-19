import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  askForBatch, resolveBatchRequest, currentBatchRequest, __resetBatchState
} from './batchRequest.ts'

const req = (frameId = 'f1') => ({
  frameId, cwd: '/tmp/p',
  spec: { goal: '重构导出', agents: [{ role: 'researcher', task: '调研' }] }
})

test('弹出 → 用户点开工 → 返回 go:true', async () => {
  __resetBatchState()
  const p = askForBatch(req(), false)
  assert.equal(currentBatchRequest()?.spec.goal, '重构导出')
  resolveBatchRequest({ go: true })
  assert.deepEqual(await p, { go: true })
})

// 「有没有一批在跑」由调用方现算传入 —— 本模块不再自己存一份。
// 存过一版（running Set + finishBatch），结果 finishBatch 只在失败路径被调，
// 派一批就永久锁死一个 Frame。教训写在 batchRequest.ts 文件头。
test('调用方说「已经有一批在跑」→ 直接拒，且提示里给出补救动作', () => {
  __resetBatchState()
  assert.throws(() => askForBatch(req(), true), /已经有一批[\s\S]*团队面板/)
})

test('调用方说「没有在跑」→ 照常弹，哪怕上一批刚点过开工', async () => {
  __resetBatchState()
  const p = askForBatch(req(), false)
  resolveBatchRequest({ go: true })
  await p
  // 现算的语义：上一批的会话如果已经不活了，这里就该放行
  assert.doesNotThrow(() => askForBatch(req(), false))
})

test('同时只允许一张清单在等', () => {
  __resetBatchState()
  void askForBatch(req(), false)
  assert.throws(() => askForBatch(req('f2'), false), /在等用户确认/)
})

test('连续取消 2 次 → 这个 Frame 本轮拉黑，且错误信息告诉它该干什么', async () => {
  __resetBatchState()
  for (let i = 0; i < 2; i++) {
    const p = askForBatch(req(), false)
    resolveBatchRequest({ go: false, reason: '不用' })
    await p
  }
  assert.throws(() => askForBatch(req(), false), /本轮不再弹[\s\S]*单会话/)
})

test('拉黑是按 Frame 的 —— 别的项目不受连累', async () => {
  __resetBatchState()
  for (let i = 0; i < 2; i++) {
    const p = askForBatch(req('f1'), false); resolveBatchRequest({ go: false }); await p
  }
  assert.doesNotThrow(() => askForBatch(req('f2'), false))
})

test('中途同意过一次，取消计数清零', async () => {
  __resetBatchState()
  let p = askForBatch(req(), false); resolveBatchRequest({ go: false }); await p
  p = askForBatch(req(), false); resolveBatchRequest({ go: true }); await p
  p = askForBatch(req(), false); resolveBatchRequest({ go: false }); await p
  assert.doesNotThrow(() => askForBatch(req(), false))
})

// ── 超时那条路 ────────────────────────────────────────────────────────
// **这组是补上来的**：原来的用例全在状态机层，一条都没碰超时，于是
// 「守卫比错了引用、整条超时是死代码」能带着「全过」进仓库
// （2026-08-19 由一个 cross-checker agent 用 mock.timers 实测抓到）。

test('没人点 → 到点自己超时返回 go:false，并清掉 pending', async (t) => {
  __resetBatchState()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const p = askForBatch(req(), false)
  assert.ok(currentBatchRequest(), '这会儿清单还挂着')
  t.mock.timers.tick(9 * 60 * 1000 + 1000)
  const d = await p
  assert.equal(d.go, false)
  assert.equal(currentBatchRequest(), null, '超时后 pending 必须清掉')
})

test('超时**不计入连续取消** —— 他只是没在电脑前，不是拒绝了你', async (t) => {
  __resetBatchState()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (let i = 0; i < 3; i++) {
    const p = askForBatch(req(), false)
    t.mock.timers.tick(9 * 60 * 1000 + 1000)
    await p
  }
  assert.doesNotThrow(() => askForBatch(req(), false))
})

test('用户在超时前点了 → 定时器跑到时什么都不该做', async (t) => {
  __resetBatchState()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const p = askForBatch(req(), false)
  resolveBatchRequest({ go: true })
  assert.deepEqual(await p, { go: true })
  t.mock.timers.tick(9 * 60 * 1000 + 1000)
  assert.equal(currentBatchRequest(), null, '不该被超时回调搅动')
})
