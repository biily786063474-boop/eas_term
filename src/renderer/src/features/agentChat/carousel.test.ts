import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DRAG_MIN,
  SWIPE_PX,
  TILT_MAX,
  clampIndex,
  dragOffset,
  settleIndex,
  tiltFor
} from './carousel.ts'

describe('角色轮播的判断层', () => {
  describe('clampIndex', () => {
    it('夹在两端，不循环', () => {
      assert.equal(clampIndex(-1, 9), 0)
      assert.equal(clampIndex(9, 9), 8)
      assert.equal(clampIndex(3, 9), 3)
    })
    it('空列表不炸', () => {
      assert.equal(clampIndex(0, 0), 0)
      assert.equal(clampIndex(5, 0), 0)
    })
  })

  describe('dragOffset 边界阻尼', () => {
    it('中间随便拖，一比一跟手', () => {
      assert.equal(dragOffset(80, 4, 9), 80)
      assert.equal(dragOffset(-80, 4, 9), -80)
    })
    it('第一张往右拖 → 阻尼', () => {
      const d = dragOffset(100, 0, 9)
      assert.ok(d > 0 && d < 100, `应被阻尼到 0..100 之间，实际 ${d}`)
    })
    it('第一张往左拖不阻尼 —— 那是要看下一张，是正常方向', () => {
      assert.equal(dragOffset(-100, 0, 9), -100)
    })
    it('最后一张往左拖 → 阻尼', () => {
      const d = dragOffset(-100, 8, 9)
      assert.ok(d < 0 && d > -100, `应被阻尼，实际 ${d}`)
    })
    it('最后一张往右拖不阻尼', () => {
      assert.equal(dragOffset(100, 8, 9), 100)
    })
    it('只有一张时两个方向都阻尼', () => {
      assert.ok(Math.abs(dragOffset(100, 0, 1)) < 100)
      assert.ok(Math.abs(dragOffset(-100, 0, 1)) < 100)
    })
  })

  describe('tiltFor', () => {
    it('0 位移不倾斜', () => {
      assert.equal(tiltFor(0), 0)
    })
    it('跟着位移同向', () => {
      assert.ok(tiltFor(30) > 0)
      assert.ok(tiltFor(-30) < 0)
    })
    it('夹在 ±TILT_MAX —— 拖再远也不翻跟头', () => {
      assert.equal(tiltFor(99999), TILT_MAX)
      assert.equal(tiltFor(-99999), -TILT_MAX)
    })
    it('TILT_MAX 本身是「轻微」的量级（< 5 度）', () => {
      assert.ok(TILT_MAX < 5, `${TILT_MAX} 度算不上轻微`)
    })
  })

  describe('settleIndex 方向', () => {
    it('往左拖过阈值 → 下一张（方向写反了这条会红）', () => {
      assert.equal(settleIndex(3, -SWIPE_PX, 9), 4)
      assert.equal(settleIndex(3, -200, 9), 4)
    })
    it('往右拖过阈值 → 上一张', () => {
      assert.equal(settleIndex(3, SWIPE_PX, 9), 2)
    })
    it('没到阈值 → 留在原地', () => {
      assert.equal(settleIndex(3, -SWIPE_PX + 1, 9), 3)
      assert.equal(settleIndex(3, SWIPE_PX - 1, 9), 3)
      assert.equal(settleIndex(3, 0, 9), 3)
    })
    it('一次只翻一张 —— 拖得再远也不会跳两格', () => {
      assert.equal(settleIndex(0, -9999, 9), 1)
    })
    it('在两端翻不出界', () => {
      assert.equal(settleIndex(0, 200, 9), 0)
      assert.equal(settleIndex(8, -200, 9), 8)
    })
  })

  it('DRAG_MIN 远小于 SWIPE_PX —— 否则「开始拖」和「翻页」会撞在一起', () => {
    assert.ok(DRAG_MIN < SWIPE_PX / 4)
  })
})
