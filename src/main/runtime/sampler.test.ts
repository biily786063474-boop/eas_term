import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCpuSampler } from './sampler.ts'
function fixture() {
 let now = 0, count = 0, fail = false
 const timers = new Map<number, () => void>(); let id = 0
 const sampler = createCpuSampler({ now: () => now, read: () => {
  if (fail) throw new Error('private diagnostic must not escape')
  count++; return [{ user: count * 50, idle: count * 50, nice: 0, sys: 0, irq: 0 }]
 }, setTimer: fn => { timers.set(++id, fn); return id }, clearTimer: h => { timers.delete(h as number) } })
 return { sampler, timers, count: () => count, fail: (v: boolean) => { fail = v }, tick: (ms = 1000) => {
  now += ms; const pending = [...timers.values()]; timers.clear(); pending.forEach(f => f())
 } }
}
test('启动幂等，只有一个定时器和最新快照', () => {
 const f = fixture(); f.sampler.start(); f.sampler.start()
 assert.equal(f.count(), 1); assert.equal(f.timers.size, 1)
 assert.equal(f.sampler.snapshot().status, 'warming')
 f.tick(); assert.equal(f.sampler.snapshot().cpuPercent, 50); assert.equal(f.timers.size, 1)
})
test('停止清理，停止后迟到定时回调也不采样', () => {
 const f = fixture(); f.sampler.start(); const late = [...f.timers.values()][0]
 f.sampler.stop(); late(); assert.equal(f.count(), 1); assert.equal(f.timers.size, 0)
 assert.equal(f.sampler.snapshot().status, 'stopped')
})
test('失败不返回旧占用，恢复先重新预热', () => {
 const f = fixture(); f.sampler.start(); f.tick(); f.fail(true); f.tick()
 assert.deepEqual(f.sampler.snapshot(), { sampledAt: 2000, cpuPercent: null, status: 'unavailable' })
 f.fail(false); f.tick(); assert.equal(f.sampler.snapshot().status, 'warming')
 f.tick(); assert.equal(f.sampler.snapshot().cpuPercent, 50)
})
test('长间隔唤醒和时间回退不复用旧基线', () => {
 const f = fixture(); f.sampler.start(); f.tick(30000)
 assert.equal(f.sampler.snapshot().status, 'warming')
 f.tick(); assert.equal(f.sampler.snapshot().cpuPercent, 50)
 f.tick(-2000); assert.equal(f.sampler.snapshot().status, 'warming')
})
test('快照不可被调用者修改；停止后重启重新预热', () => {
 const f = fixture(); f.sampler.start(); const snap = f.sampler.snapshot()
 assert.ok(Object.isFrozen(snap)); f.tick(); assert.equal(snap.status, 'warming')
 f.sampler.stop(); f.sampler.start(); assert.equal(f.sampler.snapshot().status, 'warming')
})
test('旧一代定时回调不能在重启后多开采样循环', () => {
 const f = fixture(); f.sampler.start(); const late = [...f.timers.values()][0]
 f.sampler.stop(); f.sampler.start(); late()
 assert.equal(f.count(), 2); assert.equal(f.timers.size, 1)
})
