// 二维码编码器的测试。**不看方块像不像，拿规范里的已知答案对。**
//
// 二维码的坑全在 Reed-Solomon 和掩码上，写错了的表现是「看着像个码，扫不出来」——
// 肉眼验证在这里完全无效，所以这份测试的价值全在下面第一条：
// ISO/IEC 18004 附录 I 给了 "HELLO WORLD" 在 1-M 下的完整纠错码字，对不上就是错的。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { encodeQR, rsEncode } from './qr.ts'

test('**Reed-Solomon 对规范里的已知答案** —— ISO/IEC 18004 附录 I，1-M 的 "HELLO WORLD"', () => {
  // 规范里 1-M "HELLO WORLD" 的 16 个数据码字
  const data = new Uint8Array([
    0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11
  ])
  // 规范给的纠错码字（10 个）
  const want = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]
  assert.deepEqual([...rsEncode(data, 10)], want)
})

test('RS 长度对得上：要几个纠错码字就给几个', () => {
  for (const n of [10, 16, 18, 22, 24, 26]) {
    assert.equal(rsEncode(new Uint8Array([1, 2, 3]), n).length, n)
  }
})

test('全零数据的纠错码字也是全零（GF 上的退化情形，写错很容易在这里露馅）', () => {
  assert.deepEqual([...rsEncode(new Uint8Array(16), 10)], new Array(10).fill(0))
})

// ── 方阵的结构性质（不看内容，看规范强制的形状）────────────────────
test('尺寸符合版本公式 4v+17，且随内容变长而升版本', () => {
  const a = encodeQR('http://192.168.1.20:50456/?c=ABC123')
  assert.ok(a)
  assert.equal(a.length, a[0].length, '必须是方阵')
  assert.equal((a.length - 17) % 4, 0, '尺寸必须是 4v+17')
  const b = encodeQR('x'.repeat(100))
  assert.ok(b && b.length > a.length, '内容长了版本要升上去')
})

test('三个角上有定位图案（7×7 的回字）', () => {
  const m = encodeQR('test')
  assert.ok(m)
  const n = m.length
  const finderOk = (r0: number, c0: number): boolean => {
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++) {
        const want =
          r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        if (m[r0 + r][c0 + c] !== want) return false
      }
    return true
  }
  assert.ok(finderOk(0, 0), '左上')
  assert.ok(finderOk(0, n - 7), '右上')
  assert.ok(finderOk(n - 7, 0), '左下')
  // 右下**不该有** —— 有的话说明画错了，扫码器靠这个判方向
  assert.ok(!finderOk(n - 7, n - 7), '右下不能有定位图案')
})

test('定时图案是交替的黑白（第 6 行/列）', () => {
  const m = encodeQR('test')
  assert.ok(m)
  for (let i = 8; i < m.length - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `第 6 行第 ${i} 列`)
    assert.equal(m[i][6], i % 2 === 0, `第 ${i} 行第 6 列`)
  }
})

test('固定的暗模块在 (size-8, 8) —— 规范强制，缺了扫不出来', () => {
  const m = encodeQR('test')
  assert.ok(m)
  assert.equal(m[m.length - 8][8], true)
})

test('黑白比例不至于失衡（掩码选对了的旁证）', () => {
  const m = encodeQR('http://192.168.31.126:50456/?c=WQ7T2M')
  assert.ok(m)
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  const ratio = dark / (m.length * m.length)
  assert.ok(ratio > 0.35 && ratio < 0.65, `黑占比 ${ratio.toFixed(2)} 不该偏到这个程度`)
})

test('同样的输入产出同样的方阵（没有随机性，可回归）', () => {
  const a = encodeQR('http://10.0.0.1:1234/?c=AAA111')
  const b = encodeQR('http://10.0.0.1:1234/?c=AAA111')
  assert.deepEqual(a, b)
})

test('内容不同，方阵一定不同', () => {
  assert.notDeepEqual(encodeQR('http://a/?c=1'), encodeQR('http://a/?c=2'))
})

test('**超容量返回 null，不静默截断** —— 截出来的码扫到的是半截 URL，比没有更糟', () => {
  assert.equal(encodeQR('x'.repeat(200)), null, '超过 v7 的 121 字节要返回 null')
})

test('中文也能编（UTF-8 字节模式）', () => {
  const m = encodeQR('手机端配对')
  assert.ok(m)
  assert.equal((m.length - 17) % 4, 0)
})

test('**格式信息必须是「M 级 + 某个掩码」里真实存在的那 8 个值之一**', () => {
  // 这条是补的（2026-08-28）：原来格式位的位序写反了 —— 结构测试全绿、
  // 肉眼也看不出问题，但扫码器一律读不出来，因为它读到的是一个不存在的
  // 等级/掩码组合。位序错了这条会立刻红。
  const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]
  for (const text of ['http://192.168.1.20:50456/?c=ABC123', 'test', '手机端配对']) {
    const m = encodeQR(text)
    assert.ok(m)
    const n = m.length
    const rd = (r: number, c: number): number => (m[r][c] ? 1 : 0)
    // 按规范位序读第一份（第一个位置是 bit14）
    const POS: [number, number][] = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ]
    let f1 = 0
    for (const [r, c] of POS) f1 = (f1 << 1) | rd(r, c)
    assert.ok(FORMAT_M.includes(f1), `第一份格式位 0x${f1.toString(16)} 不是合法的 M 级值`)
    // 第二份必须一模一样 —— 两份不一致的码也扫不出来
    let f2 = 0
    for (let i = 0; i < 7; i++) f2 = (f2 << 1) | rd(n - 1 - i, 8)
    for (let i = 0; i < 8; i++) f2 = (f2 << 1) | rd(8, n - 8 + i)
    assert.equal(f2, f1, '两份格式信息必须一致')
  }
})

test('空串不抛', () => {
  const m = encodeQR('')
  assert.ok(m)
})
