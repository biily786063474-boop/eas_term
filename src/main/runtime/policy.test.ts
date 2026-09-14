import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResourcePolicy } from './policy.ts'
const sample = (at: number, cpu = 20, memory = 30, critical = false) => ({ at, cpu, memory, critical })
test('普通80/节能50，任一维度高压即拦新增', () => {
 const p = createResourcePolicy(); p.update(sample(0, 79, 79)); assert.equal(p.allow(0), true)
 p.update(sample(1000, 80)); assert.equal(p.allow(1000), false)
 p.update(sample(2000, 20, 80)); assert.equal(p.allow(2000), false)
 const e = createResourcePolicy('eco'); e.update(sample(0, 50)); assert.equal(e.allow(0), false)
})
test('预估资源预留导致超线时不放行', () => {
 const p = createResourcePolicy(); p.update(sample(0, 70)); assert.equal(p.allow(0, {cpu: 10, memory: 0}), false)
 assert.equal(p.allow(0, {cpu: 2, memory: 0}), true)
})
test('持续高压锁住，恢复需连续10秒低于恢复线', () => {
 const p = createResourcePolicy(); for(let t = 0;t<3000;t+=1000)p.update(sample(t, 90))
 for(let t = 3000;t<13000;t+=1000){p.update(sample(t));assert.equal(p.allow(t), false)}
 p.update(sample(13000)); assert.equal(p.allow(13000), true)
})
test('重复/乱序快照不能累计高压次数或伪造恢复时间', () => {
 const p = createResourcePolicy(); p.update(sample(1000, 90));p.update(sample(1000, 90));p.update(sample(900, 90))
 p.update(sample(2000));assert.equal(p.allow(2000), true)
})
test('未知、过期、未来指标拒绝重任务；严重压力立刻锁住', () => {
 const p = createResourcePolicy(); assert.equal(p.allow(0), false)
 p.update({at:0,cpu:null,memory:30,critical:false});assert.equal(p.allow(0),false)
 p.update(sample(1000));assert.equal(p.allow(7000),false);assert.equal(p.allow(0),false)
 p.update(sample(2000,20,30,true));assert.equal(p.allow(2000),false)
})
test('切节能立即按新阈值检查；异常预估不可绕过', () => {
 const p = createResourcePolicy();p.update(sample(0,60));p.setMode('eco');assert.equal(p.allow(0),false)
 p.setMode('normal');assert.equal(p.allow(0),true)
 assert.equal(p.allow(0,{cpu:-5,memory:0}),false)
 assert.equal(p.allow(0,{cpu:NaN,memory:0}),false)
})
test('恢复区间中断或采样缺口不能累计连续10秒', () => {
 const p=createResourcePolicy();p.update(sample(0,20,30,true))
 p.update(sample(1000));p.update(sample(4000));p.update(sample(9000,75));p.update(sample(10000))
 p.update(sample(21000));assert.equal(p.allow(21000),false)
})
test('准入拒绝提供可区分原因，allow与decision保持一致',()=>{
 const p=createResourcePolicy()
 assert.equal(p.decision(0).reason,'metrics-unavailable')
 p.update({at:0,cpu:85,memory:20,critical:false})
 assert.equal(p.decision(0).reason,'cpu-threshold');assert.equal(p.allow(0),false)
 assert.equal(p.decision(6000).reason,'metrics-stale')
 p.update({at:6000,cpu:20,memory:85,critical:false})
 assert.equal(p.decision(6000).reason,'memory-threshold')
 p.update({at:7000,cpu:20,memory:20,critical:false})
 assert.deepEqual(p.decision(7000),{allowed:true,reason:'ready'})
})

// 2026-09-13 隔离验收两次撞到：节能下排队后切回普通，60 秒内仍不放行。这是有意的迟滞，不是 bug：
// 拥塞不随模式切换清除；恢复要 CPU 与内存都连续 10 秒低于「阈值 − 10」。把它钉住，免得下一个人当 bug 修。
test('刻画：节能下拥塞后切回普通，内存在 70% 附近晃就一直 recovering；连续 10 秒低于 70 才放行', () => {
 const p = createResourcePolicy('eco')
 for (let t = 0; t < 3000; t += 1000) p.update(sample(t, 20, 69)) // 69% ≥ 50%：三次高压 → 拥塞
 assert.equal(p.decision(2000).reason, 'memory-threshold')
 p.setMode('normal')
 p.update(sample(3000, 20, 69)); assert.equal(p.decision(3000).reason, 'recovering', '切模式不清拥塞')
 p.update(sample(7000, 20, 71)); p.update(sample(9000, 20, 69)) // 71% 打断恢复计时，9000 重新起算
 // 采样间隔必须 ≤5 秒，否则恢复计时也会被重置（稀疏采样不算「持续」）
 p.update(sample(13000, 20, 69)); p.update(sample(17000, 20, 69)); assert.equal(p.decision(17000).reason, 'recovering', '连续低于 70 但还不到 10 秒')
 p.update(sample(19500, 20, 69)); assert.equal(p.decision(19500).reason, 'ready', '从 9000 起连续 ≥10 秒低于 70 才放行')
})
