import test from 'node:test'
import assert from 'node:assert/strict'
import { livePageOwner, localPageUrl, localPageResourceAllowed, coordinate, safeText } from './livePagePolicy.ts'

test('only an identified agent leaf or PTY may own a page', () => {
  assert.equal(livePageOwner({ agentLeafId: 'leaf-1', ptyId: 'pty-1' }), 'leaf:leaf-1')
  assert.equal(livePageOwner({ ptyId: 'pty-1' }), 'pty:pty-1')
  assert.throws(() => livePageOwner({ project: '/tmp/app' }))
})
test('only loopback development pages may be opened', () => {
  assert.equal(localPageUrl('http://localhost:5173/a').href, 'http://localhost:5173/a')
  assert.equal(localPageUrl('http://127.0.0.1:3000/').href, 'http://127.0.0.1:3000/')
  assert.equal(localPageUrl('http://[::1]:8080/').href, 'http://[::1]:8080/')
  for (const url of ['file:///tmp/a.html', 'https://example.com', 'http://192.168.1.5', 'javascript:alert(1)', 'http://localhost.evil.com']) {
    assert.throws(() => localPageUrl(url), url)
  }
})
test('coordinates and typing are bounded', () => {
  assert.equal(coordinate(0.5), 0.5)
  assert.throws(() => coordinate(-1))
  assert.throws(() => coordinate(2))
  assert.equal(safeText('hello'), 'hello')
  assert.throws(() => safeText('x'.repeat(10001)))
})
test('page resources stay on loopback, including HMR websocket and blob origins', () => {
  for (const url of ['http://localhost:5173/src/main.ts', 'ws://127.0.0.1:5173/', 'wss://[::1]:3000/', 'data:image/png;base64,AA==', 'about:blank', 'blob:http://localhost:5173/id']) {
    assert.equal(localPageResourceAllowed(url), true, url)
  }
  for (const url of ['https://example.com/app.js', 'wss://remote.example/ws', 'file:///etc/hosts', 'blob:https://remote.example/id']) {
    assert.equal(localPageResourceAllowed(url), false, url)
  }
})
