import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CanvasFrame, CanvasNode } from '../../store/canvas/types.ts'
import type { GanttTask, Project } from '../../../../shared/types.ts'
import type { LeafInfo } from './collect.ts'
import { collectFiles, collectProjects, collectSessions, collectStatus, resolveFile } from './collect.ts'

/** 大多数用例不涉及 leafId 形态，用这张空表 */
const NO_LEAVES = new Map<string, LeafInfo>()

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
  const r = collectProjects([frame({ projectId: 'p1' })], ps, NO_LEAVES, [], [])
  assert.equal(r.length, 1)
  assert.equal(r[0].name, '笔纵画板')
})

test('子 Frame 里的会话算进父项目', () => {
  const top = frame({ id: 'top', projectId: 'p1', nodes: [node({ pane: { kind: 'terminal', ptyId: '1' } })] })
  const sub = frame({ parentId: 'top', projectId: 'p1', name: 'docs',
    nodes: [node({ pane: { kind: 'agent', cwd: '/x', sessionId: 'ac-2' } })] })
  const r = collectProjects([top, sub], PROJECTS, NO_LEAVES, ['1'], ['ac-2'])
  assert.equal(r[0].sessions, 2)
  assert.equal(r[0].running, 1)
  assert.equal(r[0].waiting, 1)
})

test('**还没启动的 AI 对话也要算一个会话** —— 否则手机上刚新建的看不见', () => {
  // 2026-08-29 端到端验证抓到的：手机新建成功、列表却还是空，
  // 用户会以为没建成然后再点一次。节点在画布上摆着就是存在，
  // 有没有 sessionId 只代表启没启动。
  const top = frame({ nodes: [node({ pane: { kind: 'agent', cwd: '/x' } })] })
  assert.equal(collectProjects([top], PROJECTS, NO_LEAVES, [], [])[0].sessions, 1)
  const ss = collectSessions([top], 'p1', NO_LEAVES, [], [])
  assert.equal(ss.length, 1)
  assert.equal(ss[0].started, false, '标成没启动，但要出现在列表里')
  assert.equal(ss[0].running, false)
})

test('没启动的会话用**节点 id** 回指（sessionId 每次启动都变，节点 id 稳定）', () => {
  const n1 = node({ pane: { kind: 'agent', cwd: '/x' } })
  const n2 = node({ pane: { kind: 'agent', cwd: '/x', sessionId: 'ac-9' } })
  const top = frame({ id: 'top', nodes: [n1, n2] })
  const ss = collectSessions([top], 'p1', NO_LEAVES, [], [])
  assert.equal(ss[0].id, n1.id, '没启动 → 节点 id')
  assert.equal(ss[1].id, 'ac-9', '已启动 → 会话 id')
  assert.deepEqual(ss.map((s) => s.started), [false, true])
})

test('不属于任何项目的 Frame 不进手机端', () => {
  assert.equal(collectProjects([frame({ projectId: null })], PROJECTS, NO_LEAVES, [], []).length, 0)
})

// ── 动作 1 下一层：会话 ─────────────────────────────────────────
test('会话列表：终端和 AI 对话都收，各自带 kind', () => {
  const top = frame({ id: 'top', nodes: [
    node({ pane: { kind: 'terminal', ptyId: '1' } }),
    node({ pane: { kind: 'agent', cwd: '/x', sessionId: 'ac-2' } })
  ] })
  const r = collectSessions([top], 'p1', NO_LEAVES, ['1'], [])
  assert.deepEqual(r.map((s) => s.kind), ['terminal', 'agent'])
  assert.equal(r[0].running, true)
  assert.equal(r[1].running, false)
})

test('会话名：节点自定义名 > leaf 的标题 > 兜底序号', () => {
  const top = frame({ id: 'top', nodes: [
    node({ name: '改甘特图', leafId: 'l1' }),
    node({ leafId: 'l2' }),
    node({ pane: { kind: 'terminal', ptyId: '3' } })   // 自带 pane 的没有标题来源
  ] })
  const leaves = new Map<string, LeafInfo>([
    ['l1', { kind: 'terminal', sessionId: '1', title: 'tab 标题' }],
    ['l2', { kind: 'terminal', sessionId: '2', title: '跑测试' }]
  ])
  const r = collectSessions([top], 'p1', leaves, [], [])
  assert.deepEqual(r.map((s) => s.title), ['改甘特图', '跑测试', '会话 3'])
})

test('查不到该项目的顶层 Frame 时返回空数组，不抛', () => {
  assert.deepEqual(collectSessions([], 'p1', NO_LEAVES, [], []), [])
})

// ── **走 leafId 的节点**（桌面上正常开的终端和 AI 对话全是这一种）──────
// 2026-08-29：用户报「电脑上新开的对话手机读不到」。根因是原来只认 n.pane，
// 而本机画布上 21 个节点走 leafId、只有 3 个自带 pane —— 日常在用的几乎全被漏掉。
// **当初没抓到，就是因为下面这几条用例不存在**（造数据时只用了 pane 那一种）。

test('**只有 leafId 的节点也要算会话** —— 桌面开的终端/对话全是这种', () => {
  const top = frame({
    id: 'top',
    nodes: [node({ leafId: 'L1' }), node({ leafId: 'L2' })]
  })
  const leaves = new Map<string, LeafInfo>([
    ['L1', { kind: 'terminal', sessionId: '7', title: '跑测试' }],
    ['L2', { kind: 'agent', sessionId: 'ac-3', title: '改甘特图' }]
  ])
  const ss = collectSessions([top], 'p1', leaves, ['7'], ['ac-3'])
  assert.equal(ss.length, 2, '两个都要出现')
  assert.deepEqual(ss.map((x) => x.kind), ['terminal', 'agent'])
  assert.deepEqual(ss.map((x) => x.title), ['跑测试', '改甘特图'])
  assert.equal(ss[0].running, true)
  assert.equal(ss[1].waiting, true)
  assert.equal(collectProjects([top], PROJECTS, leaves, ['7'], ['ac-3'])[0].sessions, 2)
})

test('leafId 查不到（leaf 已关）就不算会话 —— 不凭空造一个', () => {
  const top = frame({ id: 'top', nodes: [node({ leafId: '已经没了' })] })
  assert.deepEqual(collectSessions([top], 'p1', NO_LEAVES, [], []), [])
  assert.equal(collectProjects([top], PROJECTS, NO_LEAVES, [], [])[0]?.sessions ?? 0, 0)
})

test('两种形态混在一个 Frame 里都要收', () => {
  const top = frame({
    id: 'top',
    nodes: [
      node({ leafId: 'L1' }),
      node({ pane: { kind: 'agent', cwd: '/x' } }),
      node({ pane: { kind: 'code', filePath: '/x/a.md' } })
    ]
  })
  const leaves = new Map<string, LeafInfo>([['L1', { kind: 'terminal', sessionId: '1' }]])
  const ss = collectSessions([top], 'p1', leaves, [], [])
  assert.equal(ss.length, 2, '终端 + 未启动的对话；code 节点不算会话')
  assert.deepEqual(ss.map((x) => x.started), [true, false])
})

test('leafId 节点自己的 name 优先于 leaf 的标题', () => {
  const top = frame({ id: 'top', nodes: [node({ name: '我给它起的名', leafId: 'L1' })] })
  const leaves = new Map<string, LeafInfo>([['L1', { kind: 'agent', sessionId: 'ac-1', title: 'tab 标题' }]])
  assert.equal(collectSessions([top], 'p1', leaves, [], [])[0].title, '我给它起的名')
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

// ── 动态（跨项目状态汇总）────────────────────────────────────────
const gt = (o: Partial<GanttTask> & { startAt: number }): GanttTask =>
  ({ id: 'g' + Math.random(), projectId: 'p1', ptyId: '1', leafId: 'l',
     prompt: '干活', endAt: o.startAt + 60_000, ...o }) as GanttTask

test('**「等你」排在「在跑」前面** —— 它是唯一会卡住的状态', () => {
  const top = frame({ id: 'top', nodes: [node({ leafId: 'A' }), node({ leafId: 'B' })] })
  const leaves = new Map<string, LeafInfo>([
    ['A', { kind: 'agent', sessionId: 'ac-1', title: '在跑的' }],
    ['B', { kind: 'agent', sessionId: 'ac-2', title: '等你的' }]
  ])
  const r = collectStatus([top], PROJECTS, leaves, ['ac-1', 'ac-2'], ['ac-2'], [], 0)
  assert.deepEqual(r.waiting.map((x) => x.title), ['等你的'])
  assert.deepEqual(r.running.map((x) => x.title), ['在跑的'])
})

test('同一个会话既在跑又等你时，**只算「等你」不重复出现**', () => {
  const top = frame({ id: 'top', nodes: [node({ leafId: 'A' })] })
  const leaves = new Map<string, LeafInfo>([['A', { kind: 'agent', sessionId: 'x', title: 'T' }]])
  const r = collectStatus([top], PROJECTS, leaves, ['x'], ['x'], [], 0)
  assert.equal(r.waiting.length, 1)
  assert.equal(r.running.length, 0)
})

test('没启动的会话不进动态 —— 它既没在跑也没等你', () => {
  const top = frame({ id: 'top', nodes: [node({ pane: { kind: 'agent', cwd: '/x' } })] })
  const r = collectStatus([top], PROJECTS, NO_LEAVES, [], [], [], 0)
  assert.equal(r.running.length + r.waiting.length, 0)
})

test('刚完成按结束时间倒序，带项目名和用时', () => {
  const r = collectStatus([], PROJECTS, NO_LEAVES, [], [], [
    gt({ startAt: 1000, endAt: 5000, prompt: '早的' }),
    gt({ startAt: 8000, endAt: 9000, prompt: '晚的' })
  ], 10000)
  assert.deepEqual(r.finished.map((f) => f.prompt), ['晚的', '早的'])
  assert.equal(r.finished[0].durationMs, 1000)
  assert.equal(r.finished[0].projectName, '笔纵画板')
})

test('**还没结束的和被强杀的都不算「完成」** —— 说它完成了是编的', () => {
  const r = collectStatus([], PROJECTS, NO_LEAVES, [], [], [
    gt({ startAt: 1000, endAt: null }),
    gt({ startAt: 2000, endAt: null, aborted: true }),
    gt({ startAt: 3000, endAt: 4000, prompt: '真完成了' })
  ], 10000)
  assert.deepEqual(r.finished.map((f) => f.prompt), ['真完成了'])
})

test('刚完成有条数上限 —— 手机上不需要翻一整天', () => {
  const many = Array.from({ length: 30 }, (_, i) => gt({ startAt: i * 1000 }))
  assert.equal(collectStatus([], PROJECTS, NO_LEAVES, [], [], many, 0, 5).finished.length, 5)
})

test('查不到名字的项目说「（未命名项目）」，不摆 UUID', () => {
  const r = collectStatus([], PROJECTS, NO_LEAVES, [], [], [gt({ startAt: 1, projectId: '没这个' })], 0)
  assert.equal(r.finished[0].projectName, '（未命名项目）')
})

// ── sessionId 单独成字段（2026-08-30 事故）────────────────────────
//
// 手机端第二步要给会话发消息，我当时以为「有 id 就能发」——
// 但 `id` 在没启动时是**节点 id**，而且从字段名看不出区别。
// 界面判断写成 `s.sessionId` 之后**永远是 undefined**，
// 卡片全都点不进去，而且不报任何错（undefined 只是让判断静默为假）。
// 用户的原话：「无法点开对话并且无法查看对话内容」。

test('**起来了的会话要有 sessionId**，不能只藏在 id 里', () => {
  const leaves = new Map([['leaf-1', { kind: 'agent' as const, sessionId: 'ac-7' }]])
  const frames = [
    { id: 'f1', projectId: 'p1', parentId: undefined, nodes: [{ id: 'n1', leafId: 'leaf-1' }] }
  ] as never
  const out = collectSessions(frames, 'p1', leaves, ['ac-7'], [])
  assert.equal(out.length, 1)
  assert.equal(out[0].sessionId, 'ac-7', '起来了就必须给 sessionId')
  assert.equal(out[0].started, true)
})

test('**没起来的不给 sessionId** —— 没有就是没有，让调用方一眼看出发不了', () => {
  const leaves = new Map([['leaf-2', { kind: 'agent' as const, sessionId: null }]])
  const frames = [
    { id: 'f1', projectId: 'p1', parentId: undefined, nodes: [{ id: 'n9', leafId: 'leaf-2' }] }
  ] as never
  const out = collectSessions(frames, 'p1', leaves, [], [])
  assert.equal(out[0].sessionId, undefined)
  assert.equal(out[0].started, false)
  assert.equal(out[0].id, 'n9', 'id 退回节点 id（它稳定）')
})

test('**id 和 sessionId 在没启动时不是一回事** —— 这就是当初踩坑的地方', () => {
  const leaves = new Map([['leaf-3', { kind: 'agent' as const, sessionId: null }]])
  const frames = [
    { id: 'f1', projectId: 'p1', parentId: undefined, nodes: [{ id: 'node-abc', leafId: 'leaf-3' }] }
  ] as never
  const s = collectSessions(frames, 'p1', leaves, [], [])[0]
  assert.notEqual(s.id, s.sessionId, '拿 id 当 sessionId 用会把节点 id 当会话 id 发出去')
})
