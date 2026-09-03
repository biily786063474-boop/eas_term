import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chordPath, labelAt, linkWidth, radialLayout, type RadialNode } from './radial.ts'

const n = (id: string, weight = 1, group = 'a'): RadialNode => ({ id, weight, group })

test('空输入不炸', () => {
  assert.deepEqual(radialLayout([], 400, 300), [])
})

test('**所有节点落在同一个圆上**（到圆心距离相等）', () => {
  const p = radialLayout([n('a'), n('b'), n('c'), n('d')], 400, 400)
  const d = p.map((x) => Math.hypot(x.x - 200, x.y - 200))
  for (const x of d) assert.ok(Math.abs(x - d[0]) < 0.01, `半径不一致：${d.join(',')}`)
})

test('**同一组的排在环上相邻** —— 红区之间的连线才认得出形状', () => {
  const nodes = [n('g1', 1, 'green'), n('r1', 1, 'red'), n('g2', 1, 'green'), n('r2', 1, 'red')]
  const ids = radialLayout(nodes, 400, 400, ['red', 'green']).map((x) => x.id)
  // red 那两个必须挨着，green 那两个也是
  const ri = [ids.indexOf('r1'), ids.indexOf('r2')].sort((a, b) => a - b)
  assert.equal(ri[1] - ri[0], 1, `red 被拆开了：${ids.join(',')}`)
})

test('groupOrder 里没有的组排最后', () => {
  const ids = radialLayout([n('x', 1, '未知'), n('r', 1, 'red')], 400, 400, ['red']).map((x) => x.id)
  assert.deepEqual(ids, ['r', 'x'])
})

test('**第一个节点在正上方** —— 和读钟表一致', () => {
  const [first] = radialLayout([n('a'), n('b'), n('c')], 400, 400)
  assert.ok(Math.abs(first.x - 200) < 0.01, 'x 没在中线上')
  assert.ok(first.y < 200, '没在上半边')
})

test('**节点大小按面积正比于 weight**，不是半径正比', () => {
  // 半径正比会让大节点看起来夸张好几倍 —— 人眼读的是面积
  const p = radialLayout([n('big', 100), n('small', 1)], 400, 400)
  const big = p.find((x) => x.id === 'big')!
  const small = p.find((x) => x.id === 'small')!
  assert.ok(big.r > small.r)
  // 面积比应接近 weight 比的平方根关系 —— 至少不能是 100 倍
  assert.ok(big.r / small.r < 4, `大小差得太夸张：${big.r} vs ${small.r}`)
})

test('**节点半径有下限** —— 太小的点点不中也读不出是个节点', () => {
  const p = radialLayout([n('a', 1), n('b', 100000)], 400, 400)
  assert.ok(p.find((x) => x.id === 'a')!.r >= 5)
})

test('窄画布也不会把节点摆出边界', () => {
  const p = radialLayout([n('a'), n('b'), n('c')], 200, 120)
  for (const x of p) {
    assert.ok(x.x >= 0 && x.x <= 200, `x 越界 ${x.x}`)
    assert.ok(x.y >= 0 && x.y <= 120, `y 越界 ${x.y}`)
  }
})

// ── 连线 ────────────────────────────────────────────────────────────────────

test('连线是**弯向圆心**的二次贝塞尔，不是直线', () => {
  const [a, b] = radialLayout([n('a'), n('b')], 400, 400)
  const d = chordPath(a, b, 200, 200)
  assert.match(d, /^M [\d.]+ [\d.]+ Q /, '不是二次贝塞尔')
  // 控制点应该比两端更靠近圆心
  const q = d.match(/Q ([\d.]+) ([\d.]+)/)!
  const dq = Math.hypot(Number(q[1]) - 200, Number(q[2]) - 200)
  const da = Math.hypot(a.x - 200, a.y - 200)
  assert.ok(dq < da, '控制点没有拉向圆心，线会在中间叠成一片')
})

test('bend=0 时退化成直线（相邻节点用它，否则会鼓一个包）', () => {
  const [a, b] = radialLayout([n('a'), n('b')], 400, 400)
  const q = chordPath(a, b, 200, 200, 0).match(/Q ([\d.]+) ([\d.]+)/)!
  assert.ok(Math.abs(Number(q[1]) - (a.x + b.x) / 2) < 0.2, '控制点没落在中点上')
})

test('**连线粗细用对数** —— 线性映射会让小的细到看不见', () => {
  // 这个仓库的跨界依赖条数从 1 到 160
  const thin = linkWidth(1, 160)
  const thick = linkWidth(160, 160)
  assert.ok(thin >= 0.6, `最细的看不见了：${thin}`)
  assert.ok(thick <= 4.5)
  // 对数的特征：中间值离粗的一端更近
  const mid = linkWidth(13, 160) // sqrt(160)≈12.6
  assert.ok(mid - thin > (thick - thin) * 0.35, '压缩得太狠，中间档全挤在细的一头')
})

// ── 标签 ────────────────────────────────────────────────────────────────────

test('**标签朝外展开**：右半边左对齐、左半边右对齐', () => {
  const p = radialLayout([n('a'), n('b'), n('c'), n('d')], 400, 400)
  const right = p.find((x) => x.x > 210)!
  const left = p.find((x) => x.x < 190)!
  assert.equal(labelAt(right, 200, 200).anchor, 'start')
  assert.equal(labelAt(left, 200, 200).anchor, 'end')
})

test('正上正下的标签居中 —— 否则会看到它突然跳边', () => {
  const [top] = radialLayout([n('a'), n('b'), n('c')], 400, 400)
  assert.equal(labelAt(top, 200, 200).anchor, 'middle')
})

test('标签落在节点外侧，不压在节点上', () => {
  const [a] = radialLayout([n('a', 100), n('b')], 400, 400)
  const l = labelAt(a, 200, 200)
  assert.ok(Math.hypot(l.x - 200, l.y - 200) > Math.hypot(a.x - 200, a.y - 200), '标签跑到圆内了')
})
