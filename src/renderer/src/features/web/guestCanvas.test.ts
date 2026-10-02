import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canvasColor, CANVAS_DARK, CANVAS_LIGHT } from './guestCanvas.ts'

test('没声明配色的普通网页：浏览器默认白底（不跟 app 主题走）', () => {
  assert.equal(canvasColor({ css: 'normal', meta: '', prefersDark: true }), CANVAS_LIGHT)
  assert.equal(canvasColor({ css: '', meta: '', prefersDark: false }), CANVAS_LIGHT)
  assert.equal(canvasColor(null), CANVAS_LIGHT)
})

test('只声明深色的页面：深色画布，不然白底白字看不见', () => {
  assert.equal(canvasColor({ css: 'normal', meta: 'dark', prefersDark: false }), CANVAS_DARK)
  assert.equal(canvasColor({ css: 'dark', meta: '', prefersDark: false }), CANVAS_DARK)
  assert.equal(canvasColor({ css: 'only dark', meta: '', prefersDark: false }), CANVAS_DARK)
})

test('声明 light dark 的页面跟系统；根元素 CSS 优先于 meta', () => {
  assert.equal(canvasColor({ css: 'normal', meta: 'light dark', prefersDark: true }), CANVAS_DARK)
  assert.equal(canvasColor({ css: 'normal', meta: 'light dark', prefersDark: false }), CANVAS_LIGHT)
  assert.equal(canvasColor({ css: 'light', meta: 'dark', prefersDark: true }), CANVAS_LIGHT)
})
