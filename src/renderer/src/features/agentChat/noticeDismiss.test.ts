import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoDismisses, NOTICE_AUTO_MS } from './noticeDismiss.ts'

test('警告（非 fatal）会自动消失', () => {
  assert.equal(autoDismisses(false), true)
})

test('红色报错（fatal）不自动消失 —— 只能手动关', () => {
  assert.equal(autoDismisses(true), false)
})

test('自动消失是 5 秒', () => {
  assert.equal(NOTICE_AUTO_MS, 5000)
})

import { timerIntent } from './noticeDismiss.ts'

test('警告没在 hover → 计时器在跑', () => {
  assert.equal(timerIntent(false, false).running, true)
})
test('警告正被 hover → 计时器暂停', () => {
  assert.equal(timerIntent(false, true).running, false)
})
test('警告 hover 移开（hovering 回到 false）→ 重新起计时', () => {
  // 就是「hover 完不重新计时」那个 bug 的守卫：移开后 running 必须回到 true
  assert.equal(timerIntent(false, true).running, false)
  assert.equal(timerIntent(false, false).running, true)
})
test('红色报错：hover 与否都不计时', () => {
  assert.equal(timerIntent(true, false).running, false)
  assert.equal(timerIntent(true, true).running, false)
})
