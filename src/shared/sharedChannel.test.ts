import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSharedChannel, type ChannelSource } from './sharedChannel.ts'

function fakeSource() {
  const listeners = new Map<string, Set<(e: unknown, d: unknown) => void>>()
  const src: ChannelSource = {
    on: (ch, h) => { if (!listeners.has(ch)) listeners.set(ch, new Set()); listeners.get(ch)!.add(h) },
    removeListener: (ch, h) => { listeners.get(ch)?.delete(h) }
  }
  return { src, count: (ch: string) => listeners.get(ch)?.size ?? 0, emit: (ch: string, d: unknown) => { for (const h of [...(listeners.get(ch) ?? [])]) h({}, d) } }
}

test('多少订阅者，底层都只挂一个监听；全退订后摘掉', () => {
  const f = fakeSource()
  const on = createSharedChannel<number>(f.src, 'browser:route')
  const got: number[][] = [[], [], []]
  const offs = got.map((arr) => on((d) => arr.push(d)))
  assert.equal(f.count('browser:route'), 1)
  f.emit('browser:route', 7)
  assert.deepEqual(got, [[7], [7], [7]])
  offs[0](); offs[1]()
  assert.equal(f.count('browser:route'), 1)
  f.emit('browser:route', 8)
  assert.deepEqual(got, [[7], [7], [7, 8]])
  offs[2]()
  assert.equal(f.count('browser:route'), 0)
})

test('退订函数重复调用不会把别人的订阅算掉', () => {
  const f = fakeSource()
  const on = createSharedChannel<string>(f.src, 'c')
  const a: string[] = [], b: string[] = []
  const offA = on((d) => a.push(d)); on((d) => b.push(d))
  offA(); offA(); offA()
  f.emit('c', 'x')
  assert.deepEqual(a, []); assert.deepEqual(b, ['x'])
  assert.equal(f.count('c'), 1)
})

test('回调里退订自己，不影响同一轮其他订阅者', () => {
  const f = fakeSource()
  const on = createSharedChannel<number>(f.src, 'c')
  const seen: string[] = []
  const off1 = on(() => { seen.push('1'); off1() })
  on(() => seen.push('2'))
  f.emit('c', 1); f.emit('c', 2)
  assert.deepEqual(seen, ['1', '2', '2'])
})

test('全退订后再订阅会重新挂监听', () => {
  const f = fakeSource()
  const on = createSharedChannel<number>(f.src, 'c')
  const off = on(() => {}); off()
  assert.equal(f.count('c'), 0)
  const got: number[] = []
  on((d) => got.push(d))
  assert.equal(f.count('c'), 1)
  f.emit('c', 3); assert.deepEqual(got, [3])
})
