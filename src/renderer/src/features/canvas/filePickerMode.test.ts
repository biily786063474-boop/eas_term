import { test } from 'node:test'
import assert from 'node:assert/strict'

test('文件视图记住最近与文件夹，插件入口不覆盖偏好；坏值回退文件夹', async () => {
  const m = await import('./filePickerMode.ts')
  assert.equal(typeof m.readFilePickerMode, 'function')
  const data = new Map<string, string>()
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  assert.equal(m.readFilePickerMode(storage), 'tree')
  m.saveFilePickerMode(storage, 'recent')
  assert.equal(m.readFilePickerMode(storage), 'recent')
  m.saveFilePickerMode(storage, 'plugin')
  assert.equal(m.readFilePickerMode(storage), 'recent')
  m.saveFilePickerMode(storage, 'tree')
  assert.equal(m.readFilePickerMode(storage), 'tree')
  assert.equal(m.readFilePickerMode({ getItem: () => 'broken' }), 'tree')
  assert.equal(m.readFilePickerMode({ getItem: () => { throw Error('blocked') } }), 'tree')
})
