import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { planSend } from './sessionState.ts'

// Exercise the actual wireProc callbacks without starting Electron or a model.
const source = ts.createSourceFile('session.ts', readFileSync(new URL('./session.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'wireProc')!
const code = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
class FakeProcess extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
  stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
}
function setup() {
  const events: unknown[] = []
  const wire = runInNewContext(code + '\nwireProc', {
    Date, console: { error() {} },
    createStderrDiagnostics: () => ({ push: () => true, reason: () => 'fixture' }),
    feed: (_live: unknown, chunk: string) => events.push(chunk),
    handleEvent: (_live: unknown, e: unknown) => events.push(e),
    logSession() {}, refreshBoard() {}, projectRootOf: (p: string) => p,
    exitMessage: () => 'fixture exit'
  })
  const old = new FakeProcess(), current = new FakeProcess()
  const live = { proc: old as FakeProcess | undefined, rec: { id: 'fixture', cwd: '/fixture', alive: true, busy: true, lastActiveAt: 0 }, killing: false }
  wire(live, old)
  live.proc = current
  wire(live, current)
  return { events, live, old, current }
}
for (const kind of ['stdout', 'stderr', 'error', 'exit'] as const) {
  test('被替换的进程迟到 ' + kind + ' 不得修改新一轮', () => {
    const { events, live, old, current } = setup()
    const before = { ...live.rec }
    if (kind === 'stdout' || kind === 'stderr') old[kind].emit('data', 'late old output')
    else if (kind === 'error') old.emit('error', new Error('late old error'))
    else old.emit('exit', 1, null)
    assert.equal(live.proc, current)
    assert.deepEqual(live.rec, before)
    assert.deepEqual(events, [])
  })
}
test('当前进程仍处理退出及退出后管道排空，不丢失最后一块输出', () => {
  const { live, current, events } = setup()
  live.rec.busy = false
  current.emit('exit', 0, null)
  assert.equal(live.proc, undefined)
  assert.equal(live.rec.alive, false)
  current.stdout.emit('data', 'final buffered output')
  assert.deepEqual(events, ['final buffered output'])
})


test('真实投递判定：完成但未退出的 Codex 接受续聊，忙时拒绝且不应用 pending', () => {
  const deliverNode = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'deliverMessage')!
  const compiled = ts.transpileModule(deliverNode.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const calls: unknown[] = []
  const deliver = runInNewContext(compiled + '\ndeliverMessage', {
    Date, planSend, endSilence: () => null,
    handleEvent: (live: { rec: { busy: boolean } }, e: { k: string }) => { calls.push(e.k); if (e.k === 'turn.start') live.rec.busy = true },
    restartAndDeliver: (_live: unknown, opts: unknown, message: string) => { calls.push({ opts, message }); return { ok: true } },
    writeStdin: () => { throw new Error('Codex must not use stdin') }
  })
  const live = { rec: { id: 's', cli: 'codex', cwd: '/fixture', busy: false, alive: true, resumeId: 'thread-1', lastActiveAt: 0 }, proc: new FakeProcess() }
  assert.equal(deliver(live, 'next immediately').ok, true)
  assert.equal(calls[0], 'turn.start')
  assert.equal((calls[1] as { opts: { resumeId: string } }).opts.resumeId, 'thread-1')
  assert.equal(live.rec.busy, true)
  const count = calls.length
  Object.assign(live.rec, { pending: { model: 'next-model' } })
  assert.equal(deliver(live, 'duplicate while busy').ok, false)
  assert.equal(calls.length, count)
})

test('启动同步失败后恢复空闲并返回失败，下一次可以直接重试', () => {
  const names = new Set(['wireProc', 'deliverMessage', 'restartAndDeliver'])
  const compiled = ts.transpileModule(source.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text ?? '')).map(n => n.getText(source)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let attempts = 0
  const deliver = runInNewContext(compiled + '\ndeliverMessage', {
    Date, process: { execPath: '/fixture/node' }, console: { error() {} }, planSend,
    endSilence: () => null, nodeBinForHook: () => '/fixture/node',
    getAdapter: () => ({ buildArgs: () => ({ bin: '/fixture/codex', args: [], stdin: 'ignore' }) }),
    agentMcpConfigPath() {}, easPluginMcpServer() {}, mcpEnv: () => ({}), approvalEnv: () => ({}), PROBE_ENV: {},
    spawn: () => { if (++attempts === 1) throw new Error('fixture spawn failure'); return new FakeProcess() },
    handleEvent: (live: { rec: { busy: boolean } }, e: { k: string }) => { if (e.k === 'turn.start') live.rec.busy = true },
    logSession() {}, resolveAndBroadcastModels() {},
    createStderrDiagnostics: () => ({ push: () => false, reason: () => '' })
  })
  const live = { rec: { id: 's', cli: 'codex', cwd: '/fixture', busy: false, alive: false, resumeId: 'thread-1', lastActiveAt: 0 } }
  const result = deliver(live, 'retryable message')
  assert.equal(live.rec.busy, false)
  assert.equal(live.rec.alive, false)
  assert.equal(result.ok, false)
  assert.equal(deliver(live, 'retryable message').ok, true)
  assert.equal(attempts, 2)
  assert.equal(live.rec.busy, true)
})
