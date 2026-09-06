import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findWindow, frontWindow, NO_HELPER_MSG, parseWindows, type Win } from './windows.ts'

/** 2026-09-06 从真实助手输出抄的形状 */
const REAL = JSON.stringify([
  { bundleId: 'com.biily.easterm', owner: 'Eas-Term', x: 0, y: 26, width: 1147, height: 659, title: 'Eas-Term', id: 20705, pid: 41576 },
  { bundleId: 'com.apple.ActivityMonitor', owner: '活动监视器', x: 0, y: 26, width: 1127, height: 646, title: '活动监视器', id: 20800, pid: 500 },
  { bundleId: 'com.tencent.xinWeChat', owner: '微信', x: 18, y: 36, width: 747, height: 632, title: '微信', id: 20900, pid: 600 }
])

test('解析真实输出', () => {
  const r = parseWindows(REAL)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.windows.length, 3)
  assert.deepEqual(r.windows[0].bounds, { x: 0, y: 26, width: 1147, height: 659 })
  assert.equal(r.windows[0].bundleId, 'com.biily.easterm')
})

test('太小的窗口丢掉（工具条、提示框不是截图目标）', () => {
  const r = parseWindows(JSON.stringify([{ id: 1, width: 10, height: 10, x: 0, y: 0 }]))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'empty')
})

test('**坏输出要分得清是什么坏**（不是抛错、不是静默空）', () => {
  const bad = parseWindows('这不是 json')
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.reason, 'bad-output')
  const notArr = parseWindows('{"a":1}')
  assert.equal(notArr.ok === false && notArr.reason, 'bad-output')
  const empty = parseWindows('[]')
  assert.equal(empty.ok === false && empty.reason, 'empty')
  if (!empty.ok) assert.match(empty.error, /锁屏|屏幕录制/)
})

test('缺字段不抛，用 0/空串兜底', () => {
  const r = parseWindows(JSON.stringify([{ width: 100, height: 100 }]))
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.windows[0].bundleId, '')
})

test('**前台窗口跳过 Eas-Term 自己**（不截自己的界面，也避免截到自己再喂回自己）', () => {
  const r = parseWindows(REAL)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(frontWindow(r.windows)?.bundleId, 'com.apple.ActivityMonitor')
  assert.equal(frontWindow([r.windows[0]]), null, '只有自己时没有可截的前台窗口')
})

test('按标题 / bundleId / App 名找窗口，大小写不敏感', () => {
  const r = parseWindows(REAL)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(findWindow(r.windows, '微信')?.id, 20900)
  assert.equal(findWindow(r.windows, 'COM.APPLE.ACTIVITYMONITOR')?.id, 20800)
  assert.equal(findWindow(r.windows, '不存在'), null)
  assert.equal(findWindow(r.windows, '  '), null)
})

test('助手缺失的说明要讲清后果', () => {
  assert.match(NO_HELPER_MSG, /整屏/)
  assert.match(NO_HELPER_MSG, /打码/)
})
