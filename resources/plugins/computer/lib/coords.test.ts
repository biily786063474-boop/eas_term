import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitTo, findDisplay, imageToScreen, screenToImage, toPoints, toPixels, validateClick, type ShotGeometry } from './coords.ts'

/** 本机 2026-09-06 实测的真实形状：逻辑 1147×745，物理 2294×1490，scale 2 */
const MAIN = { id: 1, bounds: { x: 0, y: 0, width: 1147, height: 745 }, scaleFactor: 2 }
/** 副屏在主屏左边 —— 逻辑 x 是负的 */
const LEFT = { id: 2, bounds: { x: -1512, y: 0, width: 1512, height: 982 }, scaleFactor: 2 }

/** 全屏截图缩到长边 1280 后的几何 */
const geo: ShotGeometry = { display: MAIN, region: MAIN.bounds, image: fitTo(2294, 1490, 1280) }

test('fitTo：长边压到上限、等比；本来就小的不放大', () => {
  assert.deepEqual(fitTo(2294, 1490, 1280), { width: 1280, height: 831 })
  assert.deepEqual(fitTo(800, 600, 1280), { width: 800, height: 600 })
  assert.deepEqual(fitTo(0, 0, 1280), { width: 1, height: 1 })
})

test('**三层缩放来回一致**：图中心 ↔ 屏幕中心', () => {
  const mid = { x: geo.image.width / 2, y: geo.image.height / 2 }
  const s = imageToScreen(mid, geo)
  assert.ok(s.ok)
  if (!s.ok) return
  // 屏幕中心约 (573, 372)，允许取整误差
  assert.ok(Math.abs(s.pt.x - 573) <= 2, `x=${s.pt.x}`)
  assert.ok(Math.abs(s.pt.y - 372) <= 2, `y=${s.pt.y}`)
  const back = screenToImage(s.pt, geo)
  assert.ok(back.ok)
  if (back.ok) {
    assert.ok(Math.abs(back.pt.x - mid.x) <= 2)
    assert.ok(Math.abs(back.pt.y - mid.y) <= 2)
  }
})

test('**越界报错，绝不钳制**（钳到边缘 = 把算错变成点错东西）', () => {
  const r = imageToScreen({ x: 99999, y: 10 }, geo)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /超出/)
  assert.equal(imageToScreen({ x: -1, y: 0 }, geo).ok, false)
  assert.equal(imageToScreen({ x: NaN, y: 0 }, geo).ok, false)
})

test('区域截图：坐标要加上区域偏移，不能当成从 0 开始', () => {
  const region = { x: 500, y: 300, width: 400, height: 200 }
  const g: ShotGeometry = { display: MAIN, region, image: { width: 400, height: 200 } }
  const r = imageToScreen({ x: 0, y: 0 }, g)
  assert.ok(r.ok && r.pt.x === 500 && r.pt.y === 300, JSON.stringify(r))
})

test('**多屏负坐标**：副屏在左边时点得中，不能靠正负号判断', () => {
  assert.equal(findDisplay({ x: -800, y: 100 }, [MAIN, LEFT])?.id, 2)
  assert.equal(findDisplay({ x: 100, y: 100 }, [MAIN, LEFT])?.id, 1)
  assert.equal(findDisplay({ x: 9999, y: 100 }, [MAIN, LEFT]), null)
})

test('validateClick：没显示器（锁屏/睡眠）与点在屏外都要说人话', () => {
  const none = validateClick({ x: 1, y: 1 }, [])
  assert.equal(none.ok, false)
  if (!none.ok) assert.match(none.error, /锁屏|睡眠|显示器/)
  const out = validateClick({ x: 5000, y: 5000 }, [MAIN])
  assert.equal(out.ok, false)
  if (!out.ok) assert.match(out.error, /不在任何显示器/)
  assert.ok(validateClick({ x: 10, y: 10 }, [MAIN]).ok)
})

test('点与像素互换（scale 2）', () => {
  assert.equal(toPixels(100, 2), 200)
  assert.equal(toPoints(200, 2), 100)
})
