import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { collectLeaves } from './layout.ts'
import { belongsToProject } from '../../shared/teamWorktree.ts'

// Execute the actual production function without importing the Electron UI/store graph.
const source = readFileSync(new URL('./mcpHandler.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('mcpHandler.ts', source, ts.ScriptTarget.Latest, true)
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'resolveFrame')
assert.ok(fn)
const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function resolve(state, ctx) {
  return new Function('useStore', 'collectLeaves', 'belongsToProject', `${js}; return resolveFrame`)(
    { getState: () => state }, collectLeaves, belongsToProject
  )(ctx)
}
const leaf = (id, pane) => ({ type: 'leaf', id, pane })
function fixture() {
  return {
    tabs: [
      { root: leaf('a', { kind: 'agent', sessionId: 'ac-a' }) },
      { root: leaf('b', { kind: 'agent', sessionId: 'ac-b' }) },
      { root: leaf('t', { kind: 'terminal', ptyId: 'pty-t' }) }
    ],
    projects: [{ id: 'p', path: '/project' }, { id: 'other', path: '/other' }],
    activeProjectId: 'other',
    canvas: { frames: [
      { id: 'f-a', projectId: 'p', nodes: [{ id: 'n-a', leafId: 'a' }] },
      { id: 'f-b', projectId: 'p', nodes: [{ id: 'n-b', leafId: 'b' }, { id: 'n-t', leafId: 't' }] },
      { id: 'f-other', projectId: 'other', nodes: [] }
    ] }
  }
}
test('session selects its exact frame among same-project frames despite active project', () => {
  assert.deepEqual(resolve(fixture(), { agentSessionId: 'ac-b', project: '/project' }),
    { frameId: 'f-b', nodeId: 'n-b', projectPath: '/project' })
})
test('PTY caller keeps exact frame targeting', () => {
  assert.equal(resolve(fixture(), { ptyId: 'pty-t' }).frameId, 'f-b')
})
test('unknown and destroyed explicit identities cannot fall back', () => {
  for (const ctx of [{ agentSessionId: 'gone' }, { ptyId: 'gone' }]) {
    assert.equal(resolve(fixture(), { ...ctx, project: '/project' }), null)
  }
  const s = fixture()
  s.tabs.splice(1, 1)
  assert.equal(resolve(s, { agentSessionId: 'ac-b', project: '/project' }), null)
})
test('agent node without a mounted leaf can carry its live session', () => {
  const s = fixture()
  s.tabs.splice(1, 1)
  s.canvas.frames[1].nodes[0] = { id: 'n-b', pane: { kind: 'agent', sessionId: 'ac-b' } }
  assert.equal(resolve(s, { agentSessionId: 'ac-b', project: '/project' }).nodeId, 'n-b')
})
test('live leaf overrides stale node pane session', () => {
  const s = fixture()
  s.canvas.frames[1].nodes[0].pane = { kind: 'agent', sessionId: 'gone' }
  assert.equal(resolve(s, { agentSessionId: 'gone', project: '/project' }), null)
})
test('legacy caller without identity retains project and active fallbacks', () => {
  assert.equal(resolve(fixture(), { project: '/project' }).frameId, 'f-a')
  assert.equal(resolve(fixture(), {}).frameId, 'f-other')
  assert.equal(resolve(fixture(), { project: '/unknown' }), null)
})
test('trusted startup leaf locates first turn before session writeback', () => {
  const s = fixture()
  delete s.tabs[1].root.pane.sessionId
  assert.equal(resolve(s, { agentLeafId: 'b', agentSessionId: 'ac-b', project: '/project' }).frameId, 'f-b')
})
test('startup leaf cannot impersonate a replaced session or terminal', () => {
  for (const agentLeafId of ['b', 't', 'gone']) {
    assert.equal(resolve(fixture(), { agentLeafId, agentSessionId: 'old', project: '/project' }), null)
  }
})
test('hidden leaf without a canvas node cannot fall back to another frame', () => {
  const s = fixture()
  s.canvas.frames[1].nodes.shift()
  assert.equal(resolve(s, { agentLeafId: 'b', agentSessionId: 'ac-b', project: '/project' }), null)
})
test('phone startup node binds exact Frame before session writeback, then keeps same session', () => {
  const s = fixture()
  s.canvas.frames[1].nodes[0] = { id: 'n-b', kind: 'agent', pane: { kind: 'agent' } }
  const ctx = { agentNodeId: 'n-b', agentSessionId: 'new-session', project: '/project' }
  assert.deepEqual(resolve(s, ctx), { frameId: 'f-b', nodeId: 'n-b', projectPath: '/project' })
  s.canvas.frames[1].nodes[0].pane.sessionId = 'new-session'
  assert.equal(resolve(s, ctx).nodeId, 'n-b')
})
test('explicit node deleted, converted, or rebound never falls back to matching other identity', () => {
  for (const node of [null, { id: 'n-b', pane: { kind: 'terminal' } }, { id: 'n-b', pane: { kind: 'agent', sessionId: 'replacement' } }]) {
    const s = fixture()
    s.canvas.frames[1].nodes = node ? [node] : []
    assert.equal(resolve(s, { agentNodeId: 'n-b', agentSessionId: 'ac-a', project: '/project' }), null)
  }
})
test('explicit node and leaf must agree; live terminal or deleted leaf defeats stale agent pane', () => {
  const ctx = { agentNodeId: 'n-b', agentLeafId: 'b', agentSessionId: 'ac-b', project: '/project' }
  assert.equal(resolve(fixture(), ctx).nodeId, 'n-b')
  assert.equal(resolve(fixture(), { ...ctx, agentLeafId: 'a' }), null)
  const s = fixture()
  s.canvas.frames[1].nodes[0].pane = { kind: 'agent', sessionId: 'ac-b' }
  s.tabs[1].root.pane = { kind: 'terminal' }
  assert.equal(resolve(s, ctx), null)
  s.tabs.splice(1, 1)
  assert.equal(resolve(s, { ...ctx, agentLeafId: undefined }), null)
})
test('actual phone start forwards node identity before its first tool request and session writeback', async () => {
  const phoneSource = readFileSync(new URL('./features/phone/provider.ts', import.meta.url), 'utf8')
  const phoneAst = ts.createSourceFile('provider.ts', phoneSource, ts.ScriptTarget.Latest, true)
  const declarations = phoneAst.statements.filter(n => ts.isFunctionDeclaration(n) && ['startSession', 'findLeaf', 'agentPaneOf', 'clearResume'].includes(n.name?.text))
  const phoneJs = ts.transpileModule(declarations.map(n => n.getText(phoneAst)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const materialized of [false, true]) {
    const s = fixture()
    s.canvas.frames[0].nodes = []
    // Phone targets the project's top-level Frame.
    s.canvas.frames[0].nodes.push(materialized ? { id: 'phone', leafId: 'b' } : { id: 'phone', pane: { kind: 'agent' } })
    delete s.tabs[1].root.pane.sessionId
    s.setAgentSessionId = (_tab, _leaf, sessionId) => { s.tabs[1].root.pane.sessionId = sessionId }
    s.setNodeAgentSession = (_frame, _node, sessionId) => { s.canvas.frames[0].nodes[0].pane.sessionId = sessionId }
    s.markPhoneNode = () => {}
    // 启动前必须先把画布落盘：主进程按磁盘上的 canvas.json 核对节点归属（2026-10-02 真机回归：
    // 手机新建的节点没赶上防抖保存 → 「AI 节点不存在或重复」）。这里钉住「存盘在 start 之前」。
    const order = []
    const api = { canvas: { save: async () => { order.push('save'); return true } }, agentChat: {
      listClis: async () => [{ id: 'codex', available: true, chatSupported: true }],
      start: async options => {
        order.push('start')
        assert.equal(options.agentNodeId, 'phone')
        assert.equal(options.agentLeafId, materialized ? 'b' : undefined)
        assert.equal(resolve(s, { ...options, agentSessionId: 'new-phone' }).nodeId, 'phone')
        return { ok: true, sessionId: 'new-phone' }
      }
    } }
    const start = new Function('useStore', 'window', 'serializeCurrentCanvas', 'tr', phoneJs + '; return startSession')(
      { getState: () => s }, { api }, () => ({ frames: [] }), (k) => k)
    assert.deepEqual(await start('p', 'phone', 'hello'), { ok: true, sessionId: 'new-phone' })
    assert.deepEqual(order, ['save', 'start'], '手机启动前必须先落盘画布')
  }
})

test('手机启动旧对话：记了签发者且 CLI 可用就带 resumeId 接上；接不上清掉重起；签发者不明不猜', async () => {
  const phoneSource = readFileSync(new URL('./features/phone/provider.ts', import.meta.url), 'utf8')
  const phoneAst = ts.createSourceFile('provider.ts', phoneSource, ts.ScriptTarget.Latest, true)
  const declarations = phoneAst.statements.filter(n => ts.isFunctionDeclaration(n) && ['startSession', 'findLeaf', 'agentPaneOf', 'clearResume'].includes(n.name?.text))
  const phoneJs = ts.transpileModule(declarations.map(n => n.getText(phoneAst)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const run = async (pane, startResults) => {
    const s = fixture()
    s.canvas.frames[0].nodes = [{ id: 'phone', leafId: 'b' }]
    s.tabs[1].root.pane = { kind: 'agent', cwd: '/x', ...pane }
    const cleared = []
    s.setAgentSessionId = () => {}
    s.setAgentResumeId = (tab, leaf, id) => { cleared.push([leaf, id]); s.tabs[1].root.pane.resumeId = id }
    s.markPhoneNode = () => {}
    const calls = []
    const api = { canvas: { save: async () => true }, agentChat: {
      listClis: async () => [{ id: 'codex', available: true, chatSupported: true }, { id: 'claude', available: true, chatSupported: true }],
      start: async o => { calls.push({ cli: o.cli, resumeId: o.resumeId }); return startResults.shift() }
    } }
    const start = new Function('useStore', 'window', 'serializeCurrentCanvas', 'tr', phoneJs + '; return startSession')(
      { getState: () => s }, { api }, () => ({ frames: [] }), (k) => k)
    const r = await start('p', 'phone', 'hi')
    return { r, calls, cleared }
  }
  const ok = { ok: true, sessionId: 'ac-x' }
  let x = await run({ resumeId: 'R1', resumeCli: 'claude' }, [ok])
  assert.deepEqual(x.calls, [{ cli: 'claude', resumeId: 'R1' }], '按签发者接，不用列表第一个')
  x = await run({ resumeId: 'R1', resumeCli: 'claude' }, [{ ok: false, error: 'gone' }, ok])
  assert.deepEqual(x.calls, [{ cli: 'claude', resumeId: 'R1' }, { cli: 'codex', resumeId: undefined }])
  assert.deepEqual(x.cleared, [['b', '']], '接不上要把失效的 resumeId 清掉')
  assert.equal(x.r.ok, true)
  x = await run({ resumeId: 'R1' }, [ok])
  assert.deepEqual(x.calls, [{ cli: 'codex', resumeId: undefined }], '签发者不明不猜（2026-09-04 事故）')
  x = await run({ resumeId: 'R1', resumeCli: 'claude', worktree: { relPath: '.worktrees/a', branch: 'a' } }, [ok])
  assert.deepEqual(x.calls, [{ cli: 'codex', resumeId: undefined }], 'worktree 会话起在项目根上接不回，不硬接')
})
