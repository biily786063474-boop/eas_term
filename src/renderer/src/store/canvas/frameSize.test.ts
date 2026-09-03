import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_FRAME_MIN, FRAME_MIN, frameMinSize } from './frameSize.ts'

// 用户 2026-09-03 实拍：建了 AI 对话又删掉之后，Frame 收缩到 240×120，
// 而里面那排引导（选一个 AI 开始 + 三颗按钮 + 先开个终端）比这大得多 ——
// 内容整个溢出到虚线边框外面。

test('**空 Frame 的下限要装得下引导**，不是老那条 240×120', () => {
  const m = frameMinSize(true)
  assert.ok(m.w > FRAME_MIN.w, `宽 ${m.w} 还是老下限`)
  assert.ok(m.h > FRAME_MIN.h, `高 ${m.h} 还是老下限`)
})

test('高度要够：标题 + 两行按钮 + 逃生口 + 上下留白 + Frame 头部', () => {
  // 对着 FrameStart 的排版量的，见 frameSize.ts 的注释。
  // 这条断言的意义是「别在不核对排版的情况下把它调小」。
  assert.ok(EMPTY_FRAME_MIN.h >= 300)
})

test('宽度要够一行放下两颗按钮（每颗 min-width 92 + 间距 + 左右 padding）', () => {
  assert.ok(EMPTY_FRAME_MIN.w >= 92 * 2 + 8 + 16 * 2)
})

test('有内容的 Frame 照旧走老下限 —— 空态那条不该外溢', () => {
  assert.deepEqual(frameMinSize(false), FRAME_MIN)
})
