import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPARK, easeOut, sparkDone, sparkFrame } from './spark.ts'

test('用户给定的参数原样落在代码里（duration 660）', () => {
  assert.equal(SPARK.durationMs, 660)
})

test('ease-out：起手快、收尾慢', () => {
  assert.equal(easeOut(0), 0)
  assert.equal(easeOut(1), 1)
  assert.ok(easeOut(0.5) > 0.5, '前半程应该已经走过一半以上')
  // 后半程每一步的增量都在变小
  assert.ok(easeOut(0.9) - easeOut(0.8) < easeOut(0.2) - easeOut(0.1))
})

test('**t 超界要夹住** —— 掉帧时会一下跳过 1，不夹的话线会往回长', () => {
  const l = sparkFrame(1.7)[0]
  assert.ok(l.alpha >= 0, `alpha 变负了：${l.alpha}`)
  // 长度已经缩到 0，两端点重合
  assert.ok(Math.abs(l.x1 - l.x2) < 1e-9 && Math.abs(l.y1 - l.y2) < 1e-9)
  assert.equal(sparkFrame(-3)[0].alpha, SPARK.alpha, 't<0 应该按 0 处理')
})

test('线随进度**变短并淡出**（用户规格的原话）', () => {
  const at = (t: number) => {
    const l = sparkFrame(t)[0]
    return { len: Math.hypot(l.x2 - l.x1, l.y2 - l.y1), alpha: l.alpha }
  }
  const a = at(0.1)
  const b = at(0.6)
  assert.ok(b.len < a.len, '没变短')
  assert.ok(b.alpha < a.alpha, '没淡出')
})

test('线**向外飞散**：起点离中心越来越远', () => {
  const d = (t: number) => Math.hypot(...(([l]) => [l.x1, l.y1])(sparkFrame(t)) as [number, number])
  assert.ok(d(0.7) > d(0.1))
})

test('**克制**：根数不超过 12、透明度不到全白 —— 再多就像烟花了', () => {
  assert.ok(SPARK.count <= 12, `${SPARK.count} 根太多`)
  assert.ok(SPARK.alpha < 1)
  assert.equal(sparkFrame(0).length, SPARK.count)
})

test('seed 让同一处连点两下的线不重合（否则看着像只放了一次）', () => {
  const a = sparkFrame(0.3, 0)[0]
  const b = sparkFrame(0.3, 0.4)[0]
  assert.ok(Math.abs(a.x1 - b.x1) > 1e-6)
})

test('sparkDone 到 1 才算完 —— 调用方靠它停掉 rAF', () => {
  assert.equal(sparkDone(0.99), false)
  assert.equal(sparkDone(1), true)
})
