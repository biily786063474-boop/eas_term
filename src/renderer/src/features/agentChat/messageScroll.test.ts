import test from 'node:test'
import assert from 'node:assert/strict'
import { createMessageScroll } from './messageScroll.ts'

test('initial and late layout follow latest; manual upward scroll is preserved', () => {
  const el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const s = createMessageScroll(el)
  s.layout(); assert.equal(el.scrollTop, 1000)
  el.scrollTop = 800; el.scrollHeight = 1400
  s.layout(); assert.equal(el.scrollTop, 1400)
  el.scrollTop = 400; s.scroll()
  el.scrollHeight = 1800; s.layout(); assert.equal(el.scrollTop, 400)
  s.latest(); assert.equal(el.scrollTop, 1800)
})

test('height growth scroll event does not disable follow before resize observer', () => {
  const el = { scrollTop: 800, scrollHeight: 1000, clientHeight: 200 }
  const s = createMessageScroll(el)
  el.scrollHeight = 1600; s.scroll(); s.layout()
  assert.equal(el.scrollTop, 1600)
})

test('upward movement cancels follow even when layout also grows', () => {
  const el = { scrollTop: 800, scrollHeight: 1000, clientHeight: 200 }
  const s = createMessageScroll(el)
  el.scrollHeight = 1600; el.scrollTop = 300; s.scroll(); s.layout()
  assert.equal(el.scrollTop, 300)
})
