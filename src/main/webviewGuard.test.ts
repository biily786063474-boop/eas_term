import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hardenWebviewPreferences } from './webviewGuard.ts'

// S2：主进程 will-attach-webview 里强制剥掉 preload、关 nodeIntegration，把"渲染层约定不设"变成"主进程不允许"。
test('剥掉 preload/preloadURL，关掉 node 集成，强制隔离与 webSecurity；不改动别的字段', () => {
  const prefs: Record<string, unknown> = { preload: '/tmp/x.js', preloadURL: 'file:///tmp/x.js', nodeIntegration: true, nodeIntegrationInSubFrames: true, contextIsolation: false, webSecurity: false, allowRunningInsecureContent: true, enableBlinkFeatures: 'X', partition: 'persist:web', backgroundThrottling: false }
  const out = hardenWebviewPreferences(prefs)
  assert.equal(out, prefs, '就地修改，Electron 读的是同一个对象')
  assert.ok(!('preload' in out) && !('preloadURL' in out) && !('enableBlinkFeatures' in out))
  assert.equal(out.nodeIntegration, false); assert.equal(out.nodeIntegrationInSubFrames, false)
  assert.equal(out.contextIsolation, true); assert.equal(out.webSecurity, true); assert.equal(out.allowRunningInsecureContent, false)
  assert.equal(out.partition, 'persist:web'); assert.equal(out.backgroundThrottling, false)
})
test('也关掉 worker 里的 node、嵌套 webview、实验特性，并打开 sandbox', () => {
  const out = hardenWebviewPreferences({ nodeIntegrationInWorker: true, webviewTag: true, experimentalFeatures: true, sandbox: false })
  assert.equal(out.nodeIntegrationInWorker, false); assert.equal(out.webviewTag, false); assert.equal(out.experimentalFeatures, false); assert.equal(out.sandbox, true)
})
