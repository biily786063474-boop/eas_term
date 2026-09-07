import { test } from 'node:test'
import assert from 'node:assert/strict'
import { questionEntries, activeQuestion, railPlacement } from './questionIndex.ts'

test('目录仅收录用户提问，图片提问有名称；旧数组原地追加后仍更新', () => {
  const turns = [{ role: 'user', text: '第一问', execs: [] }, { role: 'assistant', text: '答复', execs: [] }]
  assert.deepEqual(questionEntries(turns), [{ turnIndex: 0, title: '第一问', preview: '答复' }])
  turns.push({ role: 'user', text: '', execs: [] })
  assert.equal(questionEntries(turns)[1].title, '图片或附件提问')
  assert.equal(activeQuestion([0, 300, 650], 320), 1)
})
test('目录外侧有留白才外放，窗口边缘内收，短窗口隐藏', () => {
  assert.equal(railPlacement({ left: 180, right: 900, top: 100, bottom: 700 }, 1100, 800, true)?.outside, true)
  const near = railPlacement({ left: 4, right: 700, top: 100, bottom: 700 }, 800, 800, true)
  assert.equal(near?.outside, false)
  assert.ok(near && near.left >= 12)
  assert.equal(railPlacement({ left: 30, right: 700, top: 0, bottom: 80 }, 800, 800, true), null)
})
