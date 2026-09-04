// 缩放倍率与内容缩放。**纯函数，只喂一个假的 WheelEvent。**
//
// 这一层有事故史：旧公式在鼠标滚轮下会算出 0 甚至负数，表现是
// 「往后拉一下，一步到底 20%」。下面头两条就是钉这个的。

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONTENT_MAX,
  CONTENT_MIN,
  wheelZoomFactor,
  clampContent,
  zoomContent
} from './zoomMath.ts'

const ev = (deltaY: number, deltaMode = 0): WheelEvent =>
  ({ deltaY, deltaMode }) as WheelEvent

describe('wheelZoomFactor', () => {
  it('**鼠标滚轮一格永远是 ±12%，不会归零或变负**（旧公式的事故）', () => {
    assert.ok(Math.abs(wheelZoomFactor(ev(100)) - 1 / 1.12) < 1e-9)
    assert.ok(Math.abs(wheelZoomFactor(ev(120)) - 1 / 1.12) < 1e-9, 'dy=120 也该同一格')
    assert.ok(wheelZoomFactor(ev(100)) > 0)
    assert.ok(wheelZoomFactor(ev(120)) > 0)
  })

  it('触控板的小步是连续的', () => {
    const a = wheelZoomFactor(ev(-2))
    const b = wheelZoomFactor(ev(-8))
    assert.ok(a > 1 && b > a, `捏开越多倍率越大：${a} → ${b}`)
  })

  it('方向：deltaY 正=缩小、负=放大', () => {
    assert.ok(wheelZoomFactor(ev(-3)) > 1)
    assert.ok(wheelZoomFactor(ev(3)) < 1)
  })

  it('**行/页模式要折算** —— 不折算的话这两种模式下步长小得推不动', () => {
    // deltaMode 1（行）下 deltaY=3 折算成 48，已越过「算滚轮」的 40 阈值
    assert.ok(Math.abs(wheelZoomFactor(ev(3, 1)) - 1 / 1.12) < 1e-9)
    assert.ok(Math.abs(wheelZoomFactor(ev(1, 2)) - 1 / 1.12) < 1e-9)
  })
})

describe('zoomContent', () => {
  it('夹在 CONTENT_MIN..MAX', () => {
    assert.equal(zoomContent(CONTENT_MAX, ev(-999)), CONTENT_MAX)
    assert.equal(zoomContent(CONTENT_MIN, ev(999)), CONTENT_MIN)
  })

  it('**下限比画布那对收窄** —— 最大化时人在读内容，缩到 20% 只剩一团糊', () => {
    assert.ok(CONTENT_MIN >= 0.5, `${CONTENT_MIN} 太小`)
  })

  it('上限要够大 —— 放大来读是这个功能的主要用途', () => {
    assert.ok(CONTENT_MAX >= 2.5)
  })

  it('从 1 捏开几次是单调递增的', () => {
    let s = 1
    const seq = [s]
    for (let i = 0; i < 4; i++) { s = zoomContent(s, ev(-6)); seq.push(s) }
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], seq.join(' → '))
  })
})

describe('clampContent（键盘那条用）', () => {
  it('**和捏合共用同一对上下限** —— 两条路范围不同会让人以为其中一条坏了', () => {
    assert.equal(clampContent(99), CONTENT_MAX)
    assert.equal(clampContent(0.01), CONTENT_MIN)
    assert.equal(clampContent(1.5), 1.5)
  })
})
