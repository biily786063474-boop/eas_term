import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planDockPlacement } from './planDockPlacement.ts'

const bounds = { left: 0, top: 0, right: 1200, bottom: 800 }

test('full task dock hangs outside the right edge without changing pane width', () => {
  const pane = { left: 100, top: 80, right: 700, bottom: 650 }
  const p = planDockPlacement(pane, bounds, false, false)
  assert.deepEqual(p && { side: p.side, left: p.left, width: p.width, compact: p.compact },
    { side: 'right', left: 710, width: 260, compact: false })
})

test('dock chooses the left outside edge when right space is insufficient', () => {
  const p = planDockPlacement({ left: 500, top: 80, right: 1050, bottom: 650 }, bounds, false, false)
  assert.deepEqual(p && { side: p.side, left: p.left, width: p.width, compact: p.compact },
    { side: 'left', left: 230, width: 260, compact: false })
})

test('manual collapse leaves only a narrow exterior queue marker', () => {
  const p = planDockPlacement({ left: 100, top: 80, right: 700, bottom: 650 }, bounds, true, false)
  assert.deepEqual(p && { left: p.left, width: p.width, compact: p.compact },
    { left: 710, width: 32, compact: true })
})

test('tight viewport starts collapsed, and explicit expansion stays within screen', () => {
  const tight = { left: 0, top: 0, right: 760, bottom: 500 }
  const pane = { left: 24, top: 10, right: 736, bottom: 490 }
  const marker = planDockPlacement(pane, tight, false, false)
  assert.equal(marker?.compact, true)
  assert.equal(marker?.width, 32)
  const open = planDockPlacement(pane, tight, false, true)
  assert.equal(open?.compact, false)
  assert.equal(open?.width, 260)
  assert.ok(open!.left >= tight.left + 8)
  assert.ok(open!.left + open!.width <= tight.right - 8)
})

test('offscreen pane does not leave a detached dock', () => {
  assert.equal(planDockPlacement({ left: -900, top: 30, right: -100, bottom: 500 }, bounds, false, false), null)
})

test('bottom edge reserves detail space and constrains overflow', () => {
  const p = planDockPlacement({left:100,top:700,right:700,bottom:1000}, bounds, false, false)!
  assert.ok(p.top <= 432)
  assert.equal(p.top + p.maxHeight, bounds.bottom - 8)
})
