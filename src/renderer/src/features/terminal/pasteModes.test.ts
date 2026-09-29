import test from 'node:test'
import assert from 'node:assert/strict'
import { registerPasteMode, bracketedPasteOf } from './pasteModes.ts'

test('按 ptyId 读 bracketed paste 模式；没登记 → undefined', () => {
  assert.equal(bracketedPasteOf('nope'), undefined)
  let on = false
  const off = registerPasteMode('p1', () => on)
  assert.equal(bracketedPasteOf('p1'), false)
  on = true
  assert.equal(bracketedPasteOf('p1'), true, '每次现读，不缓存')
  off()
  assert.equal(bracketedPasteOf('p1'), undefined)
})

test('后登记者不被先登记者的注销误删', () => {
  const offA = registerPasteMode('p2', () => false)
  const offB = registerPasteMode('p2', () => true)
  offA()
  assert.equal(bracketedPasteOf('p2'), true)
  offB()
  assert.equal(bracketedPasteOf('p2'), undefined)
})

test('读取抛错（终端已 dispose）→ undefined', () => {
  const off = registerPasteMode('p3', () => { throw new Error('disposed') })
  assert.equal(bracketedPasteOf('p3'), undefined)
  off()
})
