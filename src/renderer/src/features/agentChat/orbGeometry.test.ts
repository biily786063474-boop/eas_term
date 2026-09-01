import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hash,
  makeMoves,
  moveProgress,
  applyMoves,
  project,
  sizeScale,
  scaleCount,
  scaleSize,
  buildOrb,
  SOLVING,
  INLINE_TUNING,
  type Move
} from './orbGeometry.ts'

const cfg = scaleSize(scaleCount(SOLVING, INLINE_TUNING.count), INLINE_TUNING.size)

test('hash 是确定的 —— 每帧重算必须给同一套层，否则球面会每帧换拧法', () => {
  assert.equal(hash(3, 2.3), hash(3, 2.3))
  assert.notEqual(hash(3, 2.3), hash(4, 2.3))
  for (let i = 0; i < 50; i++) {
    const v = hash(i, 7.7)
    assert.ok(v >= 0 && v < 1, `hash 越界: ${v}`)
  }
})

test('层的轴、切片、角度都在合法范围内', () => {
  for (const m of makeMoves(14)) {
    assert.ok(m.axis === 0 || m.axis === 1 || m.axis === 2)
    assert.ok(m.lo >= -1 && m.lo <= 0.5, `lo=${m.lo}`)
    assert.equal(m.hi - m.lo, 0.5)
    assert.equal(Math.abs(m.ang), Math.PI / 2)
  }
})

// ── 节奏：打乱 → 复原 → 停顿 ────────────────────────────────────────────────

test('一轮走完：先逐层拧到底，再逐层退回，最后一段谁都不动', () => {
  const n = 4
  const step = 0.42
  const pause = 1.2
  const at = (t: number): ReturnType<typeof moveProgress> => moveProgress(t, n, step, pause)
  // 起点：第 0 层刚开始
  assert.equal(at(0).active, 0)
  assert.equal(at(0).amount[0], 0)
  // 打乱到一半：前面的层已经拧到底（=1）
  const mid = at(2 * step + 0.3 * step)
  assert.equal(mid.amount[0], 1)
  assert.equal(mid.amount[1], 1)
  assert.equal(mid.active, 2)
  // 复原段：同一层的 amount 往回退
  const back = at(n * step + 0.3 * step)
  assert.equal(back.active, n - 1)
  assert.ok(back.amount[n - 1] < 1 && back.amount[n - 1] > 0)
  // 停顿段：没有层在动，且全部归零
  const idle = at(2 * n * step + pause * 0.5)
  assert.equal(idle.active, -1)
  assert.deepEqual(idle.amount, new Array(n).fill(0))
})

test('**周期末尾必须回到原位** —— 复原是同一层倒放，不是另算一套反向的层', () => {
  const n = 5
  const moves = makeMoves(n)
  const p: [number, number, number] = [0.31, 0.42, 0.85]
  const cycle = 2 * n * 0.42 + 1.2
  const [x, y, z] = applyMoves(p, moves, moveProgress(cycle * 0.999, n))
  assert.ok(Math.hypot(x - p[0], y - p[1], z - p[2]) < 1e-9, '一个周期之后没回到原位')
})

test('拧不到的点原样不动（不在任何生效切片里）', () => {
  const moves: Move[] = [{ axis: 0, lo: 0.5, hi: 1, ang: Math.PI / 2 }]
  const prog = { amount: [1], active: 0 }
  const [x, y, z, act] = applyMoves([-0.9, 0, 0], moves, prog)
  assert.deepEqual([x, y, z], [-0.9, 0, 0])
  assert.equal(act, false)
})

test('拧 90° 之后半径不变（旋转不该把球拧变形）', () => {
  const moves: Move[] = [{ axis: 1, lo: -1, hi: 1, ang: Math.PI / 2 }]
  const [x, y, z, act] = applyMoves([0.6, 0.3, -0.74], moves, { amount: [1], active: 0 })
  assert.ok(Math.abs(Math.hypot(x, y, z) - Math.hypot(0.6, 0.3, -0.74)) < 1e-12)
  assert.equal(act, true, '在正被拧的那层上要报 true —— 高亮全靠它')
})

// ── 投影与缩放 ──────────────────────────────────────────────────────────────

test('投影：不转不倾时，点直接落在圆心加半径处，y 轴翻向下', () => {
  const p = project(0, 0, 50, 50, 10)
  assert.deepEqual(p(0, 0, 0), [50, 50, 0])
  assert.deepEqual(p(1, 0, 0), [60, 50, 0])
  assert.deepEqual(p(0, 1, 0), [50, 40, 0]) // 画布 y 向下
  assert.deepEqual(p(0, 0, 1), [50, 50, 1]) // 深度不乘半径
})

test('深度只在 -1..1 之间，排序和明暗都靠它', () => {
  const p = project(0.7, 0.35, 12, 12, 9)
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-0.6, 0.5, 0.62]] as const) {
    const d = p(v[0], v[1], v[2])[2]
    assert.ok(d >= -1.0000001 && d <= 1.0000001, `深度越界 ${d}`)
  }
})

test('点半径按 0.6 次方随尺寸缩 —— 线性缩的话小球的点会细到看不见', () => {
  assert.equal(sizeScale(300, 0.6), 1)
  assert.ok(sizeScale(24, 0.6) > 24 / 300, '小尺寸下相对更粗')
})

test('scaleCount 两个方向各缩 √n，总点数才是缩 n 倍', () => {
  const c = scaleCount(SOLVING, 0.25) // √0.25 = 0.5
  assert.equal(c.latRings, Math.round(SOLVING.latRings * 0.5))
  assert.equal(c.lonDensity, Math.round(SOLVING.lonDensity * 0.5))
  // 下限 2：再小也不能塌成一条线
  assert.equal(scaleCount(SOLVING, 0.0001).latRings, 2)
})

test('scaleSize 只动三个半径项，别的一律不碰', () => {
  const c = scaleSize(SOLVING, 2)
  assert.equal(c.rBase, SOLVING.rBase * 2)
  assert.equal(c.rDepth, SOLVING.rDepth * 2)
  assert.equal(c.rActive, SOLVING.rActive * 2)
  assert.equal(c.latRings, SOLVING.latRings)
  assert.equal(c.inkFar, SOLVING.inkFar)
})

// ── 整帧 ────────────────────────────────────────────────────────────────────

test('buildOrb：点数可控、全部落在画布内、半径不小于下限', () => {
  const dots = buildOrb(28, 1.3, cfg)
  // 上下界都要卡住：太少（<40）就看不出是个球——参考站 20px 那档只有 30 个点，
  // 实测渲染出来是一团散点，这一档正是为此重调的；太多则是白烧 CPU
  assert.ok(dots.length >= 40 && dots.length <= 120, `点数 ${dots.length} 不在预期量级`)
  for (const d of dots) {
    assert.ok(d.x >= -1 && d.x <= 29, `x 越界 ${d.x}`)
    assert.ok(d.y >= -1 && d.y <= 29, `y 越界 ${d.y}`)
    assert.ok(d.r >= cfg.rMin)
    assert.ok(d.lum >= 0 && d.lum <= 1, `亮度越界 ${d.lum}`)
  }
})

test('buildOrb：从远到近排好序 —— 近的后画才盖得住远的', () => {
  const dots = buildOrb(28, 0.7, cfg)
  for (let i = 1; i < dots.length; i++) assert.ok(dots[i].z >= dots[i - 1].z)
})

test('越近的点越大越亮 —— 这是它看起来是个球而不是一片噪点的全部理由', () => {
  const dots = buildOrb(64, 0.4, SOLVING)
  const far = dots[0]
  const near = dots[dots.length - 1]
  assert.ok(near.r > far.r, `近的没更大: ${near.r} vs ${far.r}`)
  assert.ok(near.lum > far.lum, `近的没更亮: ${near.lum} vs ${far.lum}`)
})

test('同一个 t 画出来的永远一样（没有 Math.random 泄漏进来）', () => {
  assert.deepEqual(buildOrb(28, 2.5, cfg), buildOrb(28, 2.5, cfg))
})
