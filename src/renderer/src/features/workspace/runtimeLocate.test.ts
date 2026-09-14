import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findServiceNode } from './runtimeLocate.ts'

const tabs = [{ root: { type: 'split', id: 's', dir: 'row', ratio: .5, children: [
  { type: 'leaf', id: 'leaf-term', pane: { kind: 'terminal', ptyId: '17' } },
  { type: 'leaf', id: 'leaf-agent', pane: { kind: 'agent', sessionId: 'ac-3' } } ] } }] as never
const frames = [{ id: 'frame-1', nodes: [{ id: 'n1', leafId: 'leaf-term' }, { id: 'n2', leafId: 'leaf-agent' }] }, { id: 'frame-2', nodes: [{ id: 'n3', leafId: 'leaf-other' }] }] as never

test('pty 服务对到终端节点，agent 服务对到对话节点', () => {
  assert.deepEqual(findServiceNode('pty:17', tabs, frames), { frameId: 'frame-1', nodeId: 'n1' })
  assert.deepEqual(findServiceNode('agent:ac-3:5', tabs, frames), { frameId: 'frame-1', nodeId: 'n2' })
})
test('不是 pty/agent、或 leaf 不在画布上、或找不到 leaf → null', () => {
  assert.equal(findServiceNode('lsp:ts', tabs, frames), null)
  assert.equal(findServiceNode('pty:999', tabs, frames), null)
  assert.equal(findServiceNode('pty:17', tabs, [] as never), null)
})
