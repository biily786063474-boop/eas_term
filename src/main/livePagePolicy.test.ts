import test from 'node:test'
import assert from 'node:assert/strict'
import { livePageOwner, localPageUrl, coordinate, safeText } from './livePagePolicy.ts'

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
