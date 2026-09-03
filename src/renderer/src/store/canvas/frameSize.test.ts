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

test('高度要够：标题 + 一行按钮 + 逃生口 + 上下留白 + Frame 头部', () => {
  // 对着 FrameStart 的排版量的，见 frameSize.ts 的注释。
  // 这条断言的意义是「别在不核对排版的情况下把它调小」。
  assert.ok(EMPTY_FRAME_MIN.h >= 200)
})

test('**宽度要够三个名字都不被截断** —— 这是空 Frame 的默认尺寸', () => {
  // 用户 2026-09-03 实拍：默认尺寸下显示成「Claude …」「默认 har…」。
  // 最长的「默认 harness」≈88px，三颗各留 ~108 + 两道 8px 间距 + 左右 padding 32。
  assert.ok(EMPTY_FRAME_MIN.w >= 108 * 3 + 8 * 2 + 16 * 2, `${EMPTY_FRAME_MIN.w} 还是会截断`)
})

test('有内容的 Frame 照旧走老下限 —— 空态那条不该外溢', () => {
  assert.deepEqual(frameMinSize(false), FRAME_MIN)
})
