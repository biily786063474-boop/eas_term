import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasExecMedia } from './execMedia.ts'

test('text-only tool calls do not reserve a media row', () => {
  assert.equal(hasExecMedia({}), false)
  assert.equal(hasExecMedia({ images: [] }), false)
  assert.equal(hasExecMedia({ imageNotice: '' }), false)
})

test('tool media or an image error reserves one row', () => {
  assert.equal(hasExecMedia({ images: [{ url: 'data:image/png;base64,AA==' }] }), true)
  assert.equal(hasExecMedia({ imageNotice: '图片无法解码' }), true)
})
