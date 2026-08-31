import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitScale, FIT_PAD } from './fitScale.ts'

const VIEW = { w: 1147, h: 636 }

test('装得下就一动不动 —— 聚焦一个小节点不该把画布放大', () => {
  assert.equal(fitScale({ w: 300, h: 220 }, VIEW, 1), 1)
  assert.equal(fitScale({ w: 300, h: 220 }, VIEW, 0.5), 0.5, '本来就缩着看也别给他放大')
})

// 用户报的那个场景：默认尺寸的节点在 1.13 倍下比视口还高
test('装不下就缩到刚好装下', () => {
  const s = fitScale({ w: 630, h: 570 }, VIEW, 1.13)
  assert.ok(s < 1.13, '没缩小，问题原样还在')
  assert.ok(570 * s <= VIEW.h, `缩完还是超高：${570 * s} > ${VIEW.h}`)
  assert.ok(630 * s <= VIEW.w)
})

// 留白不是审美，是唯一能抓着平移画布的地方
test('**缩完四周必须有留白** —— 那是唯一能抓着拖画布的地方', () => {
  const s = fitScale({ w: 2000, h: 1500 }, VIEW, 2)
  const restW = VIEW.w - 2000 * s
  const restH = VIEW.h - 1500 * s
  assert.ok(restW >= FIT_PAD * 2 - 1, `左右只剩 ${restW}px，抓不住`)
  assert.ok(restH >= FIT_PAD * 2 - 1, `上下只剩 ${restH}px，抓不住`)
})

test('高瘦和矮胖的节点各按各自吃紧的那一边算', () => {
  const tall = fitScale({ w: 100, h: 5000 }, VIEW, 2)
  assert.ok(5000 * tall <= VIEW.h, '高瘦节点该按高度算')
  const wide = fitScale({ w: 5000, h: 100 }, VIEW, 2)
  assert.ok(5000 * wide <= VIEW.w, '矮胖节点该按宽度算')
})

// 钳到画布合法区间是 setViewport 的活（clampScale），这里只保证算出来的数是正的、
// 不会把 0 或负数递过去 —— 那种值会让终端 placement 变 NaN、整屏消失
test('大到怎么缩都装不下时也给个正数，不给 0 或负数', () => {
  const s = fitScale({ w: 99999, h: 99999 }, VIEW, 1)
  assert.ok(s > 0 && s < 0.02, `算出了 ${s}`)
})

// 窄窗口：留白按比例缩水，不能变成负数
test('**窗口窄到放不下留白时，留白缩水而不是变负** —— 变负会让画面跳到最小缩放', () => {
  const narrow = { w: 80, h: 60 }
  const s = fitScale({ w: 100, h: 80 }, narrow, 1)
  assert.ok(s > 0.2, `窄窗口下算出了 ${s}，说明留白吃成负数了`)
  assert.ok(100 * s <= narrow.w && 80 * s <= narrow.h, '缩完还是装不下')
})

test('尺寸不可信时原样返回当前缩放，不拿算不出来的数去改用户的画布', () => {
  assert.equal(fitScale({ w: 0, h: 0 }, VIEW, 0.8), 0.8)
  assert.equal(fitScale({ w: -5, h: 100 }, VIEW, 0.8), 0.8)
  assert.equal(fitScale({ w: 100, h: 100 }, { w: 0, h: 0 }, 0.8), 0.8)
  assert.ok(Number.isNaN(fitScale({ w: 100, h: 100 }, VIEW, NaN)), 'NaN 原样退回，交给 setViewport 兜')
})
