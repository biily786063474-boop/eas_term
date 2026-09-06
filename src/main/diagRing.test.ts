import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Ring, formatLine, trimLog } from './diagRing.ts'

test('formatLine：ISO 时间 + 来源 + 种类 + 一句话，换行压成空格', () => {
  const l = formatLine({ t: 0, src: 'r', kind: 'unmount', what: 'cfile-node\nabc' })
  assert.equal(l, '1970-01-01T00:00:00.000Z r unmount cfile-node abc')
})

test('Ring：满了丢最老的', () => {
  const r = new Ring<number>(3)
  ;[1, 2, 3, 4, 5].forEach((n) => r.push(n))
  assert.deepEqual(r.items(), [3, 4, 5])
  assert.equal(r.size, 3)
})

test('trimLog：不超上限原样；超了砍到一半且在行边界', () => {
  assert.equal(trimLog('a\nb\n', 100), 'a\nb\n')
  const big = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n') + '\n'
  const t = trimLog(big, 300)
  assert.ok(Buffer.byteLength(t) <= 300)
  assert.ok(t.startsWith('line-'), '砍在行边界，不留半行')
  assert.ok(t.endsWith('line-99\n'))
})
