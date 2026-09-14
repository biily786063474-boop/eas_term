import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupServices, matchProject, queueReasonLabel, serviceLeafRef, servicesSummary, fmtDuration, fmtAgo, KIND_LABEL } from './runtimeView.ts'
import type { RuntimeObservedService } from '../../../../shared/runtimeResources.ts'

const svc = (id: string, kind: RuntimeObservedService['kind'], projectIds: string[], extra: Partial<RuntimeObservedService> = {}): RuntimeObservedService =>
  ({ id, name: KIND_LABEL[kind], kind, projectIds, unknownRefs: 0, uptimeMs: 60_000, state: 'running', canStop: true, ...extra })

test('按项目分组：同项目归一张卡，未关联单独一张，顺序按首次出现', () => {
  const list = [svc('pty:1', 'terminal', ['a']), svc('agent:ac-1:1', 'agent', ['b']), svc('pty:2', 'terminal', ['a']), svc('plugin:x', 'plugin', [])]
  const g = groupServices(list, 'project', (id) => ({ a: '桌面整理', b: 'AI竞技场' })[id] ?? id)
  assert.deepEqual(g.map((x) => [x.title, x.items.map((s) => s.id)]), [['桌面整理', ['pty:1', 'pty:2']], ['AI竞技场', ['agent:ac-1:1']], ['未关联', ['plugin:x']]])
})

test('按类型分组：标题用类型中文名', () => {
  const list = [svc('pty:1', 'terminal', ['a']), svc('lsp:ts', 'language-server', ['a'])]
  assert.deepEqual(groupServices(list, 'kind', (id) => id).map((x) => x.title), ['终端', '语言服务器'])
})

test('跨窗口共享的服务可能归属多个项目：每个项目的卡都出现', () => {
  const list = [svc('lsp:ts', 'language-server', ['a', 'b'])]
  const g = groupServices(list, 'project', (id) => id)
  assert.deepEqual(g.map((x) => x.title), ['a', 'b'])
})

test('摘要：按类型计数，并数出停止中的', () => {
  const list = [svc('pty:1', 'terminal', ['a']), svc('pty:2', 'terminal', ['a']), svc('agent:ac-1:1', 'agent', ['a'], { state: 'stopping', canStop: false })]
  assert.deepEqual(servicesSummary(list), { kinds: [{ kind: 'terminal', label: '终端', count: 2 }, { kind: 'agent', label: 'AI 对话', count: 1 }], stopping: 1 })
})

test('项目筛选：空 = 全部，none = 只要未关联', () => {
  assert.equal(matchProject('', ['a']), true)
  assert.equal(matchProject('a', ['a', 'b']), true)
  assert.equal(matchProject('a', ['b']), false)
  assert.equal(matchProject('none', [null]), true)
  assert.equal(matchProject('none', ['a', null]), false)
})

test('排队原因翻译，未知原因给通用说法', () => {
  assert.equal(queueReasonLabel('memory-threshold'), '内存超过当前阈值')
  assert.equal(queueReasonLabel('critical-pressure'), '系统内存压力过高')
  assert.equal(queueReasonLabel('whatever'), '等待运行名额或资源预算')
  assert.equal(queueReasonLabel(undefined), '等待运行名额或资源预算')
})

test('服务 id 解析：pty 与 agent 能对回 leaf，其它为 null', () => {
  assert.deepEqual(serviceLeafRef('pty:17'), { kind: 'terminal', ptyId: '17' })
  assert.deepEqual(serviceLeafRef('agent:ac-3:2'), { kind: 'agent', sessionId: 'ac-3' })
  assert.equal(serviceLeafRef('lsp:typescript'), null)
  assert.equal(serviceLeafRef('agent:'), null)
  assert.equal(serviceLeafRef('pty:'), null)
})

test('时长与相对时间：秒以下不显示、分钟与小时分档', () => {
  assert.equal(fmtDuration(900), '不到 1 秒')
  assert.equal(fmtDuration(12_000), '12 秒')
  assert.equal(fmtDuration(7 * 60_000 + 5000), '7 分钟')
  assert.equal(fmtDuration(3 * 3600_000 + 12 * 60_000), '3 小时 12 分')
  assert.equal(fmtAgo(2 * 60_000), '2 分钟前')
  assert.equal(fmtAgo(30_000), '30 秒前')
})
