import { recordDiagnostic } from '../diagnostics/record.ts'
import { stopAgentProcess, ownCodexLauncher } from '../../../mcp/owned-launcher-control.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { planSend } from './sessionState.ts'
import { codexAdapter } from './adapters/codex.ts'

// Exercise the actual wireProc callbacks without starting Electron or a model.
const source = ts.createSourceFile('session.ts', readFileSync(new URL('./session.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'wireProc')!
const code = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
class FakeProcess extends EventEmitter {
  kill() {}
  stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
  stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
}
test('显式打断先撤销旧进程的能力，再终止进程；ACP 取消保留连接', () => {
  let handler: ts.CallExpression | undefined
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.arguments[0]?.getText(source) === "'agentChat:interrupt'") handler = n
    ts.forEachChild(n, visit)
  }
  visit(source)
  assert.ok(handler)
  const calls: string[] = []
  const live = { rec: { id: 's', busy: true }, proc: { kill: () => calls.push('kill') }, acp: undefined as undefined | { interrupt(): boolean } }
  const compiled = ts.transpileModule('const interrupt = ' + handler.arguments[1].getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const interrupt = runInNewContext(compiled + '\ninterrupt', {
    recordDiagnostic, stopAgentProcess, ownCodexLauncher, sessions: new Map([['s', live]]),
    revokeCapabilitySession: (id: string) => calls.push('revoke:' + id),
    handleEvent() {}
  })
  interrupt({}, 's')
  assert.deepEqual(calls, ['revoke:s', 'kill'])
  calls.length = 0
  live.acp = { interrupt: () => { calls.push('cancel'); return true } }
  interrupt({}, 's')
  assert.deepEqual(calls, ['cancel'])
})
function setup() {
  const events: unknown[] = []
  const wire = runInNewContext(code + '\nwireProc', {
    recordDiagnostic, stopAgentProcess, ownCodexLauncher, Date, console: { error() {} }, revokeCapabilitySession() {},
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
    recordDiagnostic, stopAgentProcess, ownCodexLauncher, Date, planSend, endSilence: () => null,
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
    recordDiagnostic, stopAgentProcess, ownCodexLauncher, Date, process: { execPath: '/fixture/node' }, app: { getAppPath: () => '/fixture/app' },
    codexCapabilityLaunch: (command: string, args: string[]) => ({ command, args }), console: { error() {} }, planSend,
    endSilence: () => null, nodeBinForHook: () => '/fixture/node',
    getAdapter: () => ({ buildArgs: () => ({ bin: '/fixture/codex', args: [], stdin: 'ignore' }) }),
    agentMcpConfigPath() {}, sessionMcpServers: () => [], codexServers: () => [], mcpEnv: () => ({}), capabilitySessionEnv: () => ({}), sessionCapabilityGuidance: () => '', revokeCapabilitySession() {}, approvalEnv: () => ({}), PROBE_ENV: {},
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

for (const [label, mcp, expected] of [
  ['整服务', { denyServers: ['eas-term'] }, 'mcp_servers.eas-term.enabled=false'],
  ['单工具', { denyTools: ['eas-term__canvas_open_file'] }, 'mcp_servers.eas-term.disabled_tools=["canvas_open_file"]']
] as const) {
  test('MCP 关闭时启动、开启后续发仍保留角色' + label + '禁用', () => {
    const restartNode = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'restartAndDeliver')!
    const compiled = ts.transpileModule(restartNode.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    let enabled = false, snapshots = 0
    const launches: string[][] = []
    const restart = runInNewContext(compiled + '\nrestartAndDeliver', {
      recordDiagnostic, stopAgentProcess, ownCodexLauncher, Date, process: { execPath: '/fixture/node' }, app: { getAppPath: () => '/fixture/app' },
      codexCapabilityLaunch: (command: string, args: string[]) => ({ command, args }),
      getAdapter: () => codexAdapter, nodeBinForHook: () => '/fixture/node',
      agentMcpConfigPath() {}, codexServers: () => [],
      sessionMcpServers: () => { snapshots++; return enabled ? [{ name: 'eas-term', command: 'node', args: ['mcp.mjs'] }] : [] },
      mcpEnv: () => ({}), capabilitySessionEnv: () => ({}), sessionCapabilityGuidance: () => '', revokeCapabilitySession() {}, approvalEnv: () => ({}), PROBE_ENV: {},
      spawn: (_bin: string, args: string[]) => { launches.push(args); return new FakeProcess() },
      handleEvent() {}, logSession() {}, wireProc() {}, resolveAndBroadcastModels() {}
    })
    const live = { rec: { id: 's', cli: 'codex', cwd: '/fixture', knownMcpServers: [], alive: false } }
    const opts = { cwd: '/fixture', knownMcpServers: [], roleBounds: { caps: { mcp } } }
    assert.equal(restart(live, opts, 'first').ok, true)
    assert.equal(launches[0].includes(expected), false, '不存在的 server 不得产生禁用参数')
    enabled = true
    assert.equal(restart(live, opts, 'follow-up').ok, true)
    assert.ok(launches[1].includes('mcp_servers.eas-term.command="node"'))
    assert.ok(launches[1].includes(expected), '新装配的 server 必须立即受到原角色限制')
    assert.equal(snapshots, 2, '每次启动只读取一次用于 Codex 的服务快照')
  })
}
