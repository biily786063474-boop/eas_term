import assert from 'node:assert/strict'
import { test } from 'node:test'

import { impactFrom } from './repoImpact.ts'

const graph = {
  nodes: [{ id: 'src/a.ts' }, { id: 'src/b.ts' }, { id: 'src/c.ts' }, { id: 'src/d.ts' }],
  edges: [
    { from: 'src/b.ts', to: 'src/a.ts' },   // b 依赖 a
    { from: 'src/c.ts', to: 'src/b.ts' },   // c 依赖 b
    { from: 'src/a.ts', to: 'src/d.ts', circular: true },
    { from: 'src/d.ts', to: 'src/a.ts', circular: true }
  ],
  cycles: [{ edges: [{ from: 'src/a.ts', to: 'src/d.ts' }, { from: 'src/d.ts', to: 'src/a.ts' }] }]
}
const tests = ['src/a.test.ts', 'src/c.test.ts', 'other/x.test.ts']

test('反向依赖：direct 是直接 import 它的，indirect 是再往上一层（不重复、不含自己）', () => {
  const r = impactFrom(graph, ['src/a.ts'], tests)
  assert.deepEqual(r.files, ['src/a.ts'])
  assert.deepEqual(r.dependents[0], { file: 'src/a.ts', direct: ['src/b.ts', 'src/d.ts'], indirect: ['src/c.ts'] })
})

test('图上没有的文件进 unknown，不当成零依赖', () => {
  const r = impactFrom(graph, ['docs/x.md', 'src/a.ts'], tests)
  assert.deepEqual(r.unknown, ['docs/x.md'])
})

test('涉及输入文件的环被列出', () => {
  const r = impactFrom(graph, ['src/a.ts'], tests)
  assert.deepEqual(r.cycles, [['src/a.ts', 'src/d.ts']])
  assert.deepEqual(impactFrom(graph, ['src/c.ts'], tests).cycles, [])
})

test('建议回归：输入文件与其 dependents 同目录同名的测试文件，去重排序', () => {
  const messy = ['src/c.test.ts', 'other/x.test.ts', 'src/a.test.ts', 'src/c.test.ts', 'src/a.test.ts']
  const r = impactFrom(graph, ['src/a.ts'], messy)
  assert.deepEqual(r.suggestedTests, ['src/a.test.ts', 'src/c.test.ts'])
})

test('模块级图（节点是目录）：文件按最长前缀归到所属节点，files 放节点 id 去重', () => {
  const modGraph = {
    nodes: [{ id: 'Sources' }, { id: 'Sources/GestureCore' }, { id: 'Sources/App' }],
    edges: [{ from: 'Sources/App', to: 'Sources/GestureCore' }],
    cycles: []
  }
  const r = impactFrom(modGraph, [
    'Sources/GestureCore/Recognizer.swift',
    'Sources/GestureCore/Util.swift',
    'Sources/Other.swift',
    'README.md'
  ], [])
  assert.deepEqual(r.files, ['Sources/GestureCore', 'Sources'])
  assert.deepEqual(r.unknown, ['README.md'])
  assert.deepEqual(r.dependents[0], { file: 'Sources/GestureCore', direct: ['Sources/App'], indirect: [] })
})
