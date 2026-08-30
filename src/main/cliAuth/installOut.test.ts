import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installVerdict, lastLine, outLines } from './installOut.ts'

test('**进度条按 \\r 覆盖同一行，必须按 \\r 切**', () => {
  // 不切的话用户看到的是「10%20%30%」这种残影
  assert.equal(lastLine('下载中 10%\r下载中 20%\r下载中 30%'), '下载中 30%')
})

test('去掉 ANSI —— 不只是颜色，还有清行和隐藏光标', () => {
  assert.equal(lastLine('[2K[?25l[32m装好了[0m'), '装好了')
})

test('取最后一句有意义的话，空行不算', () => {
  assert.equal(lastLine('第一行\n第二行\n\n  \n'), '第二行')
})

test('太长的行截断，不撑破面板', () => {
  assert.equal(lastLine('x'.repeat(300)).length, 160)
  assert.equal(lastLine('x'.repeat(300), 20).length, 20)
})

test('空输入不抛', () => {
  assert.equal(lastLine(''), '')
  assert.equal(lastLine('\n\r\n'), '')
})

test('outLines：拆成干净的行给失败时回显', () => {
  assert.deepEqual(outLines('[31mnpm ERR! code EACCES[0m\n\nnpm ERR! syscall mkdir\n'), [
    'npm ERR! code EACCES',
    'npm ERR! syscall mkdir'
  ])
})

test('outLines 也按 \\r 切 —— 否则进度残影会混进错误回显里', () => {
  assert.deepEqual(outLines('10%\r20%\rdone'), ['10%', '20%', 'done'])
})

// ── 安装成败判定 ──────────────────────────────────────────────────
// 这一组全是 2026-08-30 真机验证抓出来的洞。第一版只看「命令在不在」，
// 于是在一台本来就装着 CLI 的机器上，失败的安装被报成成功。
test('**退出码非 0 一律失败** —— 哪怕命令本来就在（升级/重装失败的场景）', () => {
  const v = installVerdict(243, true)
  assert.equal(v.ok, false)
  assert.match(v.ok === false ? v.error : '', /243/)
})

test('退出码 0 但命令找不到 → 失败（装到了不在 PATH 的地方）', () => {
  const v = installVerdict(0, false)
  assert.equal(v.ok, false)
  assert.match(v.ok === false ? v.error : '', /PATH/)
})

test('退出码 0 且命令在 → 成功', () => {
  assert.deepEqual(installVerdict(0, true), { ok: true })
})

test('code 为 null（被信号带走）当作没有退出码，只看命令在不在', () => {
  assert.deepEqual(installVerdict(null, true), { ok: true })
  assert.equal(installVerdict(null, false).ok, false)
})
