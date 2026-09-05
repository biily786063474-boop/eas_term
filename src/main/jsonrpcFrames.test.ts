import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, encodeFrame, parseFrame, splitFrames } from './jsonrpcFrames.ts'

test('粘包：一块里两条完整消息', () => {
  const r = splitFrames('', '{"a":1}\n{"b":2}\n')
  assert.deepEqual(r.lines, ['{"a":1}', '{"b":2}'])
  assert.equal(r.rest, '')
})

test('半包：没收完的尾巴留到下一块', () => {
  const r1 = splitFrames('', '{"a":1}\n{"b"')
  assert.deepEqual(r1.lines, ['{"a":1}'])
  assert.equal(r1.rest, '{"b"')
  const r2 = splitFrames(r1.rest, ':2}\n')
  assert.deepEqual(r2.lines, ['{"b":2}'])
})

test('CRLF 与空行都吃得下', () => {
  const r = splitFrames('', '{"a":1}\r\n\n\n{"b":2}\n')
  assert.deepEqual(r.lines, ['{"a":1}', '{"b":2}'])
})

test('非法行 → null，不抛', () => {
  assert.equal(parseFrame('not json'), null)
  assert.equal(parseFrame('[1,2]'), null)
  assert.deepEqual(parseFrame('{"x":1}'), { x: 1 })
})

test('encode 带换行', () => {
  assert.equal(encodeFrame({ a: 1 }), '{"a":1}\n')
})

test('classify：请求 / 通知 / 响应', () => {
  assert.equal(classify({ id: 1, method: 'x' }), 'request')
  assert.equal(classify({ method: 'x' }), 'notification')
  assert.equal(classify({ id: 1, result: {} }), 'response')
  assert.equal(classify({ id: 1, error: {} }), 'response')
  assert.equal(classify({ foo: 1 }), 'unknown')
})
