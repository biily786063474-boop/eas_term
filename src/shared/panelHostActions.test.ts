import test from 'node:test'
import assert from 'node:assert/strict'
import { PANEL_CLIPBOARD_MAX_BYTES, clipboardTextOf, revealPathOf, hostActionAllowed, HOST_ACTION_REMOTE_ERROR, HOST_ACTION_GESTURE_ERROR } from './panelHostActions.ts'

test('剪贴板：只收非空纯文本', () => {
  assert.deepEqual(clipboardTextOf({ text: 'hi' }), { ok: true, value: 'hi' })
  for (const bad of [null, {}, { text: 1 }, { text: { html: '<b>' } }, { text: '' }]) assert.equal(clipboardTextOf(bad).ok, false)
})

test('剪贴板：按 UTF-8 字节限长 64KB（中文三字节一个，不能按字符数算）', () => {
  assert.equal(clipboardTextOf({ text: 'a'.repeat(PANEL_CLIPBOARD_MAX_BYTES) }).ok, true)
  assert.equal(clipboardTextOf({ text: 'a'.repeat(PANEL_CLIPBOARD_MAX_BYTES + 1) }).ok, false)
  assert.equal(clipboardTextOf({ text: '字'.repeat(Math.floor(PANEL_CLIPBOARD_MAX_BYTES / 3) + 1) }).ok, false)
})

test('访达定位：只收绝对路径', () => {
  assert.deepEqual(revealPathOf({ path: '/Users/x/a.mp4' }), { ok: true, value: '/Users/x/a.mp4' })
  assert.equal(revealPathOf({ path: 'C:\\x\\a.mp4' }).ok, true)
  for (const bad of [null, {}, { path: '' }, { path: 'a.mp4' }, { path: '../a' }, { path: 3 }, { path: '/' + 'a'.repeat(5000) }]) assert.equal(revealPathOf(bad).ok, false)
})

test('闸门：远程插件一律拒；本地插件要焦点在面板且是真实点击', () => {
  assert.deepEqual(hostActionAllowed({ remote: false, focused: true, activated: true }), { ok: true })
  assert.deepEqual(hostActionAllowed({ remote: true, focused: true, activated: true }), { ok: false, error: HOST_ACTION_REMOTE_ERROR })
  assert.deepEqual(hostActionAllowed({ remote: null, focused: true, activated: true }), { ok: false, error: HOST_ACTION_REMOTE_ERROR })
  assert.deepEqual(hostActionAllowed({ remote: false, focused: false, activated: true }), { ok: false, error: HOST_ACTION_GESTURE_ERROR })
  assert.deepEqual(hostActionAllowed({ remote: false, focused: true, activated: false }), { ok: false, error: HOST_ACTION_GESTURE_ERROR })
})
