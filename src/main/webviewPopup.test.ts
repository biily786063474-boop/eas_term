import {test} from 'node:test'
import assert from 'node:assert/strict'
import {webviewOpenAction, popupWebPreferences} from './webviewPopup.ts'

test('eas-favorites 内部路由 → favorites；其余 → 开受控弹窗', () => {
  assert.equal(webviewOpenAction('eas-favorites:save?name=x'), 'favorites')
  assert.equal(webviewOpenAction('about:blank'), 'popup')                       // Google GIS 先开的空白弹窗
  assert.equal(webviewOpenAction('https://accounts.google.com/o/oauth2/v2/auth'), 'popup')
  assert.equal(webviewOpenAction('https://example.com/'), 'popup')              // 普通 target=_blank
})

test('弹窗 webPreferences：无 preload、沙箱、无 nodeIntegration、共享指定 partition', () => {
  const p = popupWebPreferences('persist:browser')
  assert.equal(p.preload, undefined)
  assert.equal(p.sandbox, true)
  assert.equal(p.contextIsolation, true)
  assert.equal(p.nodeIntegration, false)
  assert.equal(p.webviewTag, false)          // 弹窗里不能再嵌 <webview>
  assert.equal(p.partition, 'persist:browser')  // 与迷你浏览器共享会话，cookie-based OAuth 也能回到父页面
})

test('弹窗加固与 <webview> 加固同一套基线（都过 hardenWebviewPreferences）', () => {
  const p = popupWebPreferences('persist:browser')
  // hardenWebviewPreferences 的关键位都在
  assert.equal(p.webSecurity, true)
  assert.equal(p.allowRunningInsecureContent, false)
  assert.equal(p.nodeIntegrationInWorker, false)
})
