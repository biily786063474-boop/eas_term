import test from 'node:test'
import assert from 'node:assert/strict'
import { groupPluginsBySource, systemPlugins, excludeSystem } from './pluginSourceGroups.ts'

const p = (id: string, cli: string, system?: boolean) => ({ id, cli, system })
const pick = (x: { cli: string; system?: boolean }) => x

test('按来源分组：Eas-Term → Claude Code → Codex → 其他，顺序固定，空组不出现', () => {
  const g = groupPluginsBySource([p('c1', 'codex'), p('e1', 'eas'), p('cl1', 'claude'), p('x1', 'weird'), p('e2', 'eas')], pick)
  assert.deepEqual(g.map(x => x.key), ['eas', 'claude', 'codex', 'other'])
  assert.deepEqual(g.map(x => x.title), ['Eas-Term 插件', '来自 Claude Code', '来自 Codex', '其他'])
  assert.deepEqual(g[0].items.map(x => x.id), ['e1', 'e2'])
  assert.deepEqual(groupPluginsBySource([p('c1', 'codex')], pick).map(x => x.key), ['codex'])
  assert.deepEqual(groupPluginsBySource([], pick), [])
})

test('system 插件被排除；全是 system 时整组消失', () => {
  const g = groupPluginsBySource([p('e1', 'eas', true), p('e2', 'eas'), p('e3', 'eas', true), p('cl', 'claude', true)], pick)
  assert.deepEqual(g.map(x => x.key), ['eas'])
  assert.deepEqual(g[0].items.map(x => x.id), ['e2'])
})

test('组内沿用输入顺序，不重排', () => {
  const g = groupPluginsBySource([p('b', 'eas'), p('a', 'eas'), p('c', 'eas')], pick)
  assert.deepEqual(g[0].items.map(x => x.id), ['b', 'a', 'c'])
})

test('systemPlugins 只取 system:true', () => {
  assert.deepEqual(systemPlugins([p('a', 'eas', true), p('b', 'eas'), p('c', 'claude')]).map(x => x.id), ['a'])
})

test('excludeSystem 去掉 system 项，保持顺序，不改其它项', () => {
  const list = [{ id: 'a', plugin: { system: true } }, { id: 'b', plugin: {} }, { id: 'c' }, { id: 'd', plugin: { system: false } }]
  assert.deepEqual(excludeSystem(list, x => x.plugin).map(x => x.id), ['b', 'c', 'd'])
})
