import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RESIZING_CLASS, startResizeDrag, type ResizeDragEnv } from './resizeDrag.ts'

function fakeEnv() {
  const classes = new Set<string>()
  const L: Record<string, Set<(e: any) => void>> = {}
  const target = () => ({
    addEventListener: (t: string, l: any) => void (L[t] ??= new Set()).add(l),
    removeEventListener: (t: string, l: any) => void L[t]?.delete(l)
  })
  const doc = Object.assign(target(), {
    body: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } }
  })
  const env = { doc, win: target() } as unknown as ResizeDragEnv
  const fire = (t: string, e: object = {}) => [...(L[t] ?? [])].forEach((l) => l(e))
  return { env, classes, fire, count: () => Object.values(L).reduce((n, s) => n + s.size, 0) }
}

describe('startResizeDrag', () => {
  it('start adds class; mouseup removes it, detaches listeners and ends once', () => {
    const f = fakeEnv()
    let ends = 0
    startResizeDrag(() => {}, () => ends++, f.env)
    assert.ok(f.classes.has(RESIZING_CLASS))
    f.fire('mouseup')
    f.fire('mouseup')
    assert.ok(!f.classes.has(RESIZING_CLASS))
    assert.equal(ends, 1)
    assert.equal(f.count(), 0)
  })
  it('window blur ends the drag', () => {
    const f = fakeEnv()
    let ends = 0
    startResizeDrag(() => {}, () => ends++, f.env)
    f.fire('blur')
    assert.ok(!f.classes.has(RESIZING_CLASS))
    assert.equal(ends, 1)
  })
  it('a move with buttons===0 ends the drag instead of resizing', () => {
    const f = fakeEnv()
    const moves: number[] = []
    let ends = 0
    startResizeDrag((e) => moves.push(e.clientX), () => ends++, f.env)
    f.fire('mousemove', { buttons: 1, clientX: 5 })
    f.fire('mousemove', { buttons: 0, clientX: 9 })
    f.fire('mousemove', { buttons: 1, clientX: 12 })
    assert.deepEqual(moves, [5])
    assert.equal(ends, 1)
    assert.ok(!f.classes.has(RESIZING_CLASS))
  })
  it('Escape and unmount stop() end the drag', () => {
    const f = fakeEnv()
    let ends = 0
    startResizeDrag(() => {}, () => ends++, f.env)
    f.fire('keydown', { key: 'a' })
    assert.equal(ends, 0)
    f.fire('keydown', { key: 'Escape' })
    assert.equal(ends, 1)
    const stop = startResizeDrag(() => {}, () => ends++, f.env)
    stop()
    assert.equal(ends, 2)
    assert.ok(!f.classes.has(RESIZING_CLASS))
  })
})
