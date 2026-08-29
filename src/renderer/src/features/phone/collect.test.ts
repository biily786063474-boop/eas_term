import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CanvasFrame, CanvasNode } from '../../store/canvas/types.ts'
import type { Project } from '../../../../shared/types.ts'
import { collectFiles, collectProjects, collectSessions, resolveFile } from './collect.ts'

let seq = 0
const node = (o: Partial<CanvasNode> & { pane?: CanvasNode['pane'] }): CanvasNode =>
  ({ id: 'n' + ++seq, x: 0, y: 0, w: 100, h: 100, ...o }) as CanvasNode

const frame = (o: Partial<CanvasFrame>): CanvasFrame =>
  ({ id: 'f' + ++seq, projectId: 'p1', name: 'F', x: 0, y: 0, w: 9, h: 9,
     collapsed: false, nodes: [], ...o }) as CanvasFrame

const PROJECTS: Project[] = [{ id: 'p1', name: '笔纵画板', path: '/x', addedAt: 0 }]

// ── 动作 1：项目 ────────────────────────────────────────────────
test('只列画布上有顶层 Frame 的项目，projects.json 里的其余不出现', () => {
  const ps = [...PROJECTS, { id: 'p2', name: '没摆出来的', path: '/y', addedAt: 0 }]
  const r = collectProjects([frame({ projectId: 'p1' })], ps, [], [])
  assert.equal(r.length, 1)
  assert.equal(r[0].name, '笔纵画板')
})

test('子 Frame 里的会话算进父项目', () => {
  const top = frame({ id: 'top', projectId: 'p1', nodes: [node({ pane: { kind: 'terminal', ptyId: '1' } })] })
  const sub = frame({ parentId: 'top', projectId: 'p1', name: 'docs',
    nodes: [node({ pane: { kind: 'agent', cwd: '/x', sessionId: 'ac-2' } })] })
  const r = collectProjects([top, sub], PROJECTS, ['1'], ['ac-2'])
  assert.equal(r[0].sessions, 2)
  assert.equal(r[0].running, 1)
  assert.equal(r[0].waiting, 1)
})

test('没起来的会话（没有 ptyId/sessionId）不计数', () => {
  const top = frame({ nodes: [node({ pane: { kind: 'agent', cwd: '/x' } })] })
  assert.equal(collectProjects([top], PROJECTS, [], [])[0].sessions, 0)
})

test('不属于任何项目的 Frame 不进手机端', () => {
  assert.equal(collectProjects([frame({ projectId: null })], PROJECTS, [], []).length, 0)
})

// ── 动作 1 下一层：会话 ─────────────────────────────────────────
test('会话列表：终端和 AI 对话都收，各自带 kind', () => {
  const top = frame({ id: 'top', nodes: [
    node({ pane: { kind: 'terminal', ptyId: '1' } }),
    node({ pane: { kind: 'agent', cwd: '/x', sessionId: 'ac-2' } })
  ] })
  const r = collectSessions([top], 'p1', new Map(), ['1'], [])
  assert.deepEqual(r.map((s) => s.kind), ['terminal', 'agent'])
  assert.equal(r[0].running, true)
  assert.equal(r[1].running, false)
})

test('会话名：节点自定义名 > tab 标题 > 兜底序号', () => {
  const top = frame({ id: 'top', nodes: [
    node({ name: '改甘特图', leafId: 'l1', pane: { kind: 'terminal', ptyId: '1' } }),
    node({ leafId: 'l2', pane: { kind: 'terminal', ptyId: '2' } }),
    node({ pane: { kind: 'terminal', ptyId: '3' } })
  ] })
  const r = collectSessions([top], 'p1', new Map([['l2', '跑测试']]), [], [])
  assert.deepEqual(r.map((s) => s.title), ['改甘特图', '跑测试', '终端 3'])
})

test('查不到该项目的顶层 Frame 时返回空数组，不抛', () => {
  assert.deepEqual(collectSessions([], 'p1', new Map(), [], []), [])
})

// ── 动作 3：文件 ────────────────────────────────────────────────
test('只收 code / image 两种 pane，且必须挂着文件', () => {
  const top = frame({ id: 'top', nodes: [
    node({ pane: { kind: 'code', filePath: '/x/a.md' } }),
    node({ pane: { kind: 'image', filePath: '/x/b.png' } }),
    node({ pane: { kind: 'terminal', ptyId: '1' } }),
    node({ pane: { kind: 'code', filePath: null } })      // 空的不收
  ] })
  const r = collectFiles([top], 'p1')
  assert.deepEqual(r.map((f) => f.kind), ['doc', 'image'])
})

test('**freeNodes 排除**——签名里根本没有它，只能从 frames 收', () => {
  // 这条测的是口径：collectFiles 的入参只有 frames，
  // 也就是说画布上散落的自由节点在类型层面就进不来
  const top = frame({ id: 'top', nodes: [node({ pane: { kind: 'code', filePath: '/x/in-frame.md' } })] })
  const r = collectFiles([top], 'p1')
  assert.equal(r.length, 1)
  assert.equal(r[0].name, 'in-frame.md')
})

test('名字取路径最后一段；Windows 反斜杠也切得动', () => {
  const top = frame({ id: 'top', nodes: [
    node({ pane: { kind: 'code', filePath: 'C:\\proj\\docs\\规格.md' } })
  ] })
  assert.equal(collectFiles([top], 'p1')[0].name, '规格.md')
})

test('**不返回绝对路径**——返回的对象里没有 path 这个键', () => {
  const top = frame({ id: 'top', nodes: [node({ pane: { kind: 'code', filePath: '/secret/dir/a.md' } })] })
  const f = collectFiles([top], 'p1')[0]
  assert.equal('path' in f, false, '路径本身就是信息，不能给手机')
  assert.equal(JSON.stringify(f).includes('/secret/'), false)
})

test('按画布位置排：先上后下，同高先左后右', () => {
  const top = frame({ id: 'top', nodes: [
    node({ x: 10, y: 200, pane: { kind: 'code', filePath: '/x/c.md' } }),
    node({ x: 90, y: 10, pane: { kind: 'code', filePath: '/x/b.md' } }),
    node({ x: 10, y: 10, pane: { kind: 'code', filePath: '/x/a.md' } })
  ] })
  assert.deepEqual(collectFiles([top], 'p1').map((f) => f.name), ['a.md', 'b.md', 'c.md'])
})

test('子 Frame 的文件带自己的组名', () => {
  const top = frame({ id: 'top', name: '笔纵画板', nodes: [node({ pane: { kind: 'code', filePath: '/x/a.md' } })] })
  const sub = frame({ parentId: 'top', name: 'docs', nodes: [node({ pane: { kind: 'code', filePath: '/x/docs/b.md' } })] })
  assert.deepEqual(collectFiles([top, sub], 'p1').map((f) => f.group), ['笔纵画板', 'docs'])
})

// ── 动作 4：按 id 反查 ──────────────────────────────────────────
test('resolveFile：Frame 里的节点查得到路径', () => {
  const n = node({ pane: { kind: 'code', filePath: '/x/a.md' } })
  const top = frame({ id: 'top', nodes: [n] })
  assert.deepEqual(resolveFile([top], 'p1', n.id), { path: '/x/a.md', kind: 'doc' })
})

test('resolveFile：编的 id 查不到 —— 第一道校验就是干这个的', () => {
  const top = frame({ id: 'top', nodes: [node({ pane: { kind: 'code', filePath: '/x/a.md' } })] })
  assert.equal(resolveFile([top], 'p1', '伪造的-id'), null)
})

test('resolveFile：终端节点的 id 也查不到（它不是文件）', () => {
  const n = node({ pane: { kind: 'terminal', ptyId: '1' } })
  const top = frame({ id: 'top', nodes: [n] })
  assert.equal(resolveFile([top], 'p1', n.id), null)
})

test('resolveFile：**跨项目查不到** —— 拿 A 项目的 id 去 B 项目问，返回 null', () => {
  const n = node({ pane: { kind: 'code', filePath: '/x/a.md' } })
  const a = frame({ id: 'ta', projectId: 'p1', nodes: [n] })
  const b = frame({ id: 'tb', projectId: 'p2', nodes: [] })
  assert.equal(resolveFile([a, b], 'p2', n.id), null)
})
