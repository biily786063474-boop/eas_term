import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dangoShape, dangoTimeline, faceHoles, FEET_MIN_PX, type DangoState } from './dangoGrid.ts'

const STATES: DangoState[] = ['idle', 'run', 'wait', 'done', 'bg', 'err']
/** 把路径里的矩形段还原成格子集合，方便断言 */
function cells(path: string): Set<string> {
  const out = new Set<string>()
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v4h-\d+z/g)) {
    const x0 = +m[1] / 4, y = +m[2] / 4, w = +m[3] / 4
    for (let x = x0; x < x0 + w; x++) out.add(x + ',' + y)
  }
  return out
}

test('72px 及以下不画脚，并裁掉底部两行；更大的尺寸有两段下划线脚', () => {
  const small = dangoShape('idle', 72), big = dangoShape('idle', FEET_MIN_PX)
  assert.equal([...cells(small.path)].some(k => k.endsWith(',19')), false)
  assert.equal([...cells(big.path)].filter(k => k.endsWith(',19')).length, 12)
  assert.equal(small.viewBox, '0 8 96 64')
  assert.equal(big.viewBox, '0 8 96 72')
  assert.equal(small.width, 72); assert.equal(small.height, 48)
})

test('只输出实心格：眼睛和嘴是镂空（真透明），不是另一种颜色', () => {
  const c = cells(dangoShape('idle', 48).path)
  for (const [x, y] of faceHoles('idle')) assert.equal(c.has(x + ',' + y), false, `${x},${y} 应该是镂空`)
  assert.ok(c.has('11,6'), '脸中间的实心格还在')
})

test('每个状态的脸都不一样，且镂空都落在身体内部', () => {
  const faces = new Set(STATES.map(s => JSON.stringify(faceHoles(s))))
  assert.equal(faces.size, STATES.length - 1) // idle 和 run 同脸，靠动作区分
  for (const s of STATES) for (const [x, y] of faceHoles(s)) {
    assert.ok(x >= 3 && x <= 20 && y >= 6 && y <= 16, `${s}: ${x},${y} 越出了脸`)
  }
})

test('运行中：左耳（光标）按 530ms 闪，眼睛左右扫；其余只有 idle 会眨眼', () => {
  const run = dangoTimeline('run')
  assert.equal(run.length, 8)
  assert.ok(run.every(([, ms]) => ms === 530))
  assert.deepEqual([...new Set(run.map(([f]) => f.eyeDx))].sort(), [-1, 0, 1])
  const earless = cells(dangoShape('run', 24, { earOn: false }).path)
  assert.equal(earless.has('6,2'), false, '光标耳熄灭的那一帧左耳整块消失')
  assert.equal(earless.has('16,2'), true, '右耳不闪')
  assert.deepEqual(dangoTimeline('idle').map(([f]) => !!f.closed), [false, true])
  for (const s of ['wait', 'done', 'bg', 'err'] as const) assert.equal(dangoTimeline(s).length, 1, `${s} 静止`)
})
