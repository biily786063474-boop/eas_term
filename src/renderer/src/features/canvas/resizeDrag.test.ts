import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DRAGGING_CLASS, RESIZING_CLASS, startCanvasDrag, startResizeDrag, type ResizeDragEnv } from './resizeDrag.ts'

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

// 2026-09-29：插件 iframe 始终接收指针后，框选 / 拖节点 / 平移划过 iframe 也会丢 mousemove/mouseup
//（真机：框选进了插件面板就停，松手后选框还跟着鼠标）。缩放那套收尾推广成所有画布拖拽共用。
describe('startCanvasDrag', () => {
  it('adds canvas-dragging for the whole gesture and passes the real mouseup to onEnd', () => {
    const f = fakeEnv()
    const ends: unknown[] = []
    startCanvasDrag(() => {}, (ev) => ends.push(ev), { env: f.env })
    assert.ok(f.classes.has(DRAGGING_CLASS))
    const up = { clientX: 3 }
    f.fire('mouseup', up)
    assert.deepEqual(ends, [up])
    assert.ok(!f.classes.has(DRAGGING_CLASS))
    assert.equal(f.count(), 0)
  })
  it('non-mouseup endings (lost mouseup, Escape, blur, stop) call onEnd without an event', () => {
    for (const how of ['move0', 'esc', 'blur', 'stop'] as const) {
      const f = fakeEnv()
      const ends: unknown[] = []
      const stop = startCanvasDrag(() => {}, (ev) => ends.push(ev), { env: f.env })
      if (how === 'move0') f.fire('mousemove', { buttons: 0 })
      if (how === 'esc') f.fire('keydown', { key: 'Escape' })
      if (how === 'blur') f.fire('blur')
      if (how === 'stop') stop()
      assert.deepEqual(ends, [undefined], how)
      assert.ok(!f.classes.has(DRAGGING_CLASS), how)
      assert.equal(f.count(), 0, how)
    }
  })
  it('a blur guard replaces the immediate window blur and is detached on end', () => {
    const f = fakeEnv()
    let realBlur: (() => void) | null = null
    let detached = 0
    let ends = 0
    startCanvasDrag(() => {}, () => ends++, {
      env: f.env,
      blurGuard: (end) => { realBlur = end; return () => detached++ }
    })
    f.fire('blur')
    assert.equal(ends, 0, 'plain window blur is ignored when a guard is supplied')
    realBlur!()
    assert.equal(ends, 1)
    assert.equal(detached, 1)
    assert.equal(f.count(), 0)
  })
  it('overlapping gestures keep the body class until the last one ends', () => {
    const f = fakeEnv()
    const a = startCanvasDrag(() => {}, () => {}, { env: f.env })
    const b = startCanvasDrag(() => {}, () => {}, { env: f.env })
    a()
    assert.ok(f.classes.has(DRAGGING_CLASS))
    b()
    assert.ok(!f.classes.has(DRAGGING_CLASS))
  })
})
