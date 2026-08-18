import { test } from 'node:test'
import assert from 'node:assert/strict'
import { briefError } from './islandBrief.ts'

test('带类型的保留类型名', () => {
  assert.equal(briefError(new TypeError('boom')), 'TypeError: boom')
})

// 「Error: xxx」读起来是废话，普通 Error 不加前缀
test('普通 Error 不重复带前缀', () => {
  assert.equal(briefError(new Error('短消息')), '短消息')
})

// 岛只有一条胶囊那么宽，长了会把窗口撑坏
test('超长截断到 90 字符以内', () => {
  const out = briefError(new RangeError('a'.repeat(300)))
  assert.ok(out.length <= 90, `长度 ${out.length}`)
  assert.ok(out.endsWith('…'))
})

test('只取第一行，stack 不会破坏单行布局', () => {
  assert.equal(briefError(Object.assign(new Error('第一行\n第二行'), { name: 'SyntaxError' })), 'SyntaxError: 第一行')
})

// 兜底本身不能再抛 —— 它是最后一道防线
test('null / 空对象不抛', () => {
  assert.equal(briefError(null), '未知错误')
  assert.equal(briefError(undefined), '未知错误')
  // 没有 message 的对象不能变成 "[object Object]" —— 显示给用户等于没说
  assert.equal(briefError({}), '未知错误')
  // 只有类型名没有 message：留住类型名，它本身就是信息
  assert.equal(briefError({ name: 'TypeError' }), 'TypeError:')
})
