// 终端输出的留存与清洗。**测的是「不拖慢终端」和「读出来是人话」。**
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanLines, createTermTailStore, MAX_BYTES, MAX_LINES } from './termTail.ts'

/** ESC。测试里用转义写，别把裸控制字符塞进源码 —— 那种字符在 diff 和终端里都是隐形的 */
const E = ''

// ── 清洗 ──────────────────────────────────────────────────────────
test('去掉颜色码', () => {
  assert.deepEqual(cleanLines(`${E}[32m成功${E}[0m`), ['成功'])
})

test('去掉光标移动 / 清行这类，不只是颜色', () => {
  // 只挡颜色的话，手机上会看到一堆残留的方括号数字
  assert.deepEqual(cleanLines(`${E}[2K${E}[1A已完成`), ['已完成'])
})

test('**\\r 当行覆盖处理** —— 进度条是原地重画的', () => {
  // 不处理的话手机上看到的是「10%20%30%」一长串残影
  assert.deepEqual(cleanLines('下载 10%\r下载 60%\r下载 100%'), ['下载 100%'])
})

test('多行里各自处理 \\r', () => {
  assert.deepEqual(cleanLines('第一行\n进度 1%\r进度 99%\n第三行'), [
    '第一行',
    '进度 99%',
    '第三行'
  ])
})

test('**中间的空行留着** —— 那是排版，抹掉会挤成一团', () => {
  assert.deepEqual(cleanLines('甲\n\n乙'), ['甲', '', '乙'])
})

test('末尾的空行去掉（终端输出通常以换行结尾）', () => {
  assert.deepEqual(cleanLines('甲\n乙\n\n\n'), ['甲', '乙'])
})

test('行数封顶，留最后那些', () => {
  const many = Array.from({ length: 500 }, (_, i) => `第${i}行`).join('\n')
  const out = cleanLines(many, 10)
  assert.equal(out.length, 10)
  assert.equal(out[9], '第499行')
})

test('空输入不抛', () => {
  assert.deepEqual(cleanLines(''), [])
})

// ── 留存 ──────────────────────────────────────────────────────────
test('存原始、读时清洗', () => {
  const s = createTermTailStore()
  s.push('p1', `${E}[31m错了${E}[0m\n`)
  assert.deepEqual(s.recent('p1'), ['错了'])
})

test('分块到达能拼起来', () => {
  const s = createTermTailStore()
  s.push('p1', '前半')
  s.push('p1', '后半\n')
  assert.deepEqual(s.recent('p1'), ['前半后半'])
})

test('终端之间互不串', () => {
  const s = createTermTailStore()
  s.push('a', 'A 的输出\n')
  s.push('b', 'B 的输出\n')
  assert.deepEqual(s.recent('a'), ['A 的输出'])
  assert.deepEqual(s.recent('b'), ['B 的输出'])
})

test('**按字节封顶，不是按行** —— 一行可以无限长', () => {
  // 按行数封顶挡不住 base64 / minified JS 那种超长单行
  const s = createTermTailStore(1000)
  s.push('p1', 'x'.repeat(5000))
  assert.ok(s.bytes('p1') <= 1000, `涨到了 ${s.bytes('p1')}`)
})

test('砍的是开头，留下的是最新的', () => {
  const s = createTermTailStore(20)
  s.push('p1', '老内容老内容老内容\n')
  s.push('p1', '新内容\n')
  assert.ok(s.recent('p1').join('\n').includes('新内容'))
})

test('终端没了要能丢掉', () => {
  const s = createTermTailStore()
  s.push('p1', '内容\n')
  s.drop('p1')
  assert.equal(s.bytes('p1'), 0)
  assert.deepEqual(s.recent('p1'), [])
})

test('没记过的返回空数组', () => {
  assert.deepEqual(createTermTailStore().recent('没这个'), [])
})

test('默认上限是给手机看的量级', () => {
  assert.equal(MAX_BYTES, 32 * 1024)
  assert.equal(MAX_LINES, 300)
})

// ── 真实 zsh 输出（2026-08-30 事故回归）──────────────────────────
//
// **上一版正则坏掉时，上面那些测试全是绿的。**
// 我在源码里把 ESC 直接写成了字面量，落盘时丢了 —— 于是正则变成
// 「匹配任意方括号数字」和「从任意 ] 开始贪婪吃到底」，把真实输出整段清空。
// 而测试里用转义写的样本，正好被那个坏正则的另一个分支吃掉，**凑巧也过了**。
// 手机上读到全是空行，是实测才发现的。
//
// 这条拿**真实形态**的 zsh 输出做样本：OSC 设标题 + CSI 颜色 + 清行 + CRLF。
// **判据不是「没有控制字符」，而是正文一个字都不能少** ——
// 上一版正是「控制字符确实没了，正文也没了」。
const BEL = ''

test('**真实 zsh 输出：控制序列清掉，正文一字不少**', () => {
  const raw =
    E + ']2;biily@Mac /tmp' + BEL +
    E + '[1m' + E + '[32mbiily' + E + '[0m@Mac /tmp % echo 手机能看到这一行\r\n' +
    '手机能看到这一行\r\n' +
    E + ']2;ls' + BEL + E + '[K' +
    'bin\r\nlib\r\nlocal\r\n' +
    E + '[1m' + E + '[32mbiily' + E + '[0m@Mac /tmp % '
  const out = cleanLines(raw)
  const joined = out.join('\n')
  for (const must of ['手机能看到这一行', 'bin', 'lib', 'local', 'biily@Mac /tmp %']) {
    assert.ok(joined.includes(must), `丢了「${must}」—— 清洗把正文吃掉了`)
  }
  assert.ok(!joined.includes(E), '还有 ESC 残留')
  assert.ok(!joined.includes(BEL), '还有 BEL 残留')
  // **不能全是空行** —— 那正是坏掉时的症状
  assert.ok(out.some((l) => l.trim()), '全是空行')
})

test('OSC 设标题不会吃掉它后面的内容', () => {
  // 坏正则里那条 OSC 分支是贪婪的，会从第一个 ] 一直吃到结尾
  assert.deepEqual(cleanLines(E + ']0;标题' + BEL + '真正的输出\n'), ['真正的输出'])
})

test('退格这类裸控制字符清掉，但不影响分行', () => {
  assert.deepEqual(cleanLines('abcd\n第二行'), ['abcd', '第二行'])
})
