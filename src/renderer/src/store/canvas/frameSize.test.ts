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

test('高度要够：标题 + **一行**按钮 + 逃生口 + 上下留白 + Frame 头部', () => {
  // 对着 FrameStart 的排版量的，见 frameSize.ts 的注释。
  // 这条断言的意义是「别在不核对排版的情况下把它调小」。
  // 2026-09-03 从「两行」改成「一行」（用户要求三颗永远同一行），高度跟着降。
  assert.ok(EMPTY_FRAME_MIN.h >= 240)
})

test('**宽度要够三颗挤在一行** —— 它们不许换行了', () => {
  // 三颗各 ~76（缩到最窄仍可读）+ 两道 8px 间距 + 左右 padding 32
  assert.ok(EMPTY_FRAME_MIN.w >= 76 * 3 + 8 * 2 + 16 * 2)
})

test('有内容的 Frame 照旧走老下限 —— 空态那条不该外溢', () => {
  assert.deepEqual(frameMinSize(false), FRAME_MIN)
})
