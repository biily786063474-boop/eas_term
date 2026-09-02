import { test } from 'node:test'
import assert from 'node:assert/strict'

import { invertTransform, sameRect, FLIP_MS } from './flip.ts'

// ── FLIP 的倒推变换 ───────────────────────────────────────────────────────
//
// 元素此刻已经在终态（布局生效了），这个 transform 要让它**看起来**还在起点。
// 算错了的症状很隐蔽：动画照跑，只是起点不对 —— 看着像「从旁边飞进来」。

test('从小矩形放大到全屏：先平移回起点，再缩到起点的比例', () => {
  const from = { left: 100, top: 50, w: 400, h: 300 }
  const to = { left: 0, top: 0, w: 1200, h: 900 }
  assert.equal(invertTransform(from, to), 'translate(100px, 50px) scale(0.3333333333333333, 0.3333333333333333)')
})

test('缩小（还原）方向也成立 —— 同一个公式，比例大于 1', () => {
  const from = { left: 0, top: 0, w: 1200, h: 900 }
  const to = { left: 100, top: 50, w: 400, h: 300 }
  assert.equal(invertTransform(from, to), 'translate(-100px, -50px) scale(3, 3)')
})

test('**终态宽高为 0 时不倒推** —— 除以 0 得 Infinity，整条 transform 会被判无效', () => {
  // 症状是「动画根本不发生」，而不是报错 —— 最难查的那一类。
  const t = invertTransform({ left: 0, top: 0, w: 100, h: 100 }, { left: 0, top: 0, w: 0, h: 0 })
  assert.ok(!t.includes('Infinity'), t)
  assert.match(t, /scale\(1, 1\)/)
})

test('起点终点重合 → 单位变换（不该产生任何位移）', () => {
  const r = { left: 10, top: 20, w: 300, h: 200 }
  assert.equal(invertTransform(r, r), 'translate(0px, 0px) scale(1, 1)')
})

// ── 要不要动画 ────────────────────────────────────────────────────────────

test('几乎没变就别动画 —— 硬跑一遍只会闪一下', () => {
  assert.equal(sameRect({ left: 0, top: 0, w: 100, h: 100 }, { left: 0.4, top: 0, w: 100, h: 100 }), true)
})

test('差得明显就要动画', () => {
  assert.equal(sameRect({ left: 0, top: 0, w: 100, h: 100 }, { left: 40, top: 0, w: 100, h: 100 }), false)
})

test('**放大比缩小长** —— 放大是展开给你看，缩小是收回去，拖沓反而碍事', () => {
  assert.ok(FLIP_MS.grow > FLIP_MS.shrink)
  // 都得在「看得出是动画」和「等得不耐烦」之间
  for (const v of Object.values(FLIP_MS)) assert.ok(v >= 180 && v <= 400, String(v))
})
