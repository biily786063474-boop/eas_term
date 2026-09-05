import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeRunner, resolveCommand } from './nodeBin.ts'

const el = '/Applications/X.app/Contents/MacOS/X'

test('有 homebrew node 就用它', () => {
  const r = nodeRunner(['a.mjs'], { electron: el, platform: 'darwin', exists: (p) => p === '/opt/homebrew/bin/node' })
  assert.equal(r.command, '/opt/homebrew/bin/node')
  assert.deepEqual(r.args, ['a.mjs'])
  assert.equal(r.env, undefined)
})

test('**一个候选都没有 → 用 Electron 自己当 node（ELECTRON_RUN_AS_NODE）**，不会 ENOENT', () => {
  const r = nodeRunner(['a.mjs'], { electron: el, platform: 'darwin', exists: () => false })
  assert.equal(r.command, el)
  assert.deepEqual(r.env, { ELECTRON_RUN_AS_NODE: '1' })
})

test('Windows 不探 unix 路径，直接回退 Electron', () => {
  const r = nodeRunner(['a.mjs'], { electron: el, platform: 'win32', exists: () => true })
  assert.equal(r.command, el)
})

test('resolveCommand：裸 node 才解析，别的命令原样', () => {
  const o = { electron: el, platform: 'darwin' as const, exists: () => false }
  assert.equal(resolveCommand('node', ['s.mjs'], o).command, el)
  assert.equal(resolveCommand('python3', ['s.py'], o).command, 'python3')
})
