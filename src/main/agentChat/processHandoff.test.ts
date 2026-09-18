import { cancelPluginTurn } from '../pluginEvents.ts'
import { timelineGuidance, timelineRuntime } from '../timelineRuntime.ts'
import { stopAgentProcess, ownCodexLauncher } from '../../../mcp/owned-launcher-control.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import {createOwnedSessions} from '../runtime/ownedSessions.ts'
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
  const live = { rec: { id: 's', busy: true }, proc: { kill: () => calls.push('kill') }, acp: undefined as undefined | { interrupt(): boolean; phase(): string } }
  const compiled = ts.transpileModule('const interrupt = ' + handler.arguments[1].getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const interrupt = runInNewContext(compiled + '\ninterrupt', {
    runtimeProcessGeneration:0, ownedSessions:createOwnedSessions(()=>0), projectAttribution:()=>null, loadProjects:()=>[], cancelRuntimeStartup(){},
    resetUsageCost() {}, interruptUsage() {}, markUsageInterrupted() {},
    cancelPluginTurn, timelineGuidance, timelineRuntime, stopAgentProcess, ownCodexLauncher, sessions: new Map([['s', live]]),
    revokeCapabilitySession: (id: string) => calls.push('revoke:' + id),
    forgetPty: (id: string) => calls.push('secret-revoke:' + id),
    handleEvent() {}
  })
  interrupt({}, 's')
  assert.deepEqual(calls, ['revoke:s', 'secret-revoke:s', 'kill'])
  calls.length = 0
  live.acp = { phase: () => 'prompting', interrupt: () => { calls.push('cancel'); return true } }
  interrupt({}, 's')
  assert.deepEqual(calls, ['cancel'])
})
function setup() {
  const events: unknown[] = []
  const wire = runInNewContext(code + '\nwireProc', {
    runtimeProcessGeneration:0, ownedSessions:createOwnedSessions(()=>0), projectAttribution:()=>null, loadProjects:()=>[], cancelRuntimeStartup(){},
    resetUsageCost() {}, interruptUsage() {}, markUsageInterrupted() {},
    cancelPluginTurn, timelineGuidance, timelineRuntime, stopAgentProcess, ownCodexLauncher, Date, console: { error() {} }, revokeCapabilitySession() {}, forgetPty() {}, withAgentSecrets: (_id: string, env: unknown) => env, endSilence: () => null,
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
    runtimeProcessGeneration:0, ownedSessions:createOwnedSessions(()=>0), projectAttribution:()=>null, loadProjects:()=>[], cancelRuntimeStartup(){},
    resetUsageCost() {}, interruptUsage() {}, markUsageInterrupted() {},
    cancelPluginTurn, timelineGuidance, timelineRuntime, stopAgentProcess, ownCodexLauncher, Date, planSend, endSilence: () => null,
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

test('准入后的实际启动失败恢复空闲，显式下一次启动可重试', () => {
  const names = new Set(['wireProc', 'deliverMessage', 'restartAndDeliverNow'])
  const compiled = ts.transpileModule(source.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text ?? '')).map(n => n.getText(source)).join('\n').replaceAll('restartAndDeliverNow','restartAndDeliver'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let attempts = 0
  const deliver = runInNewContext(compiled + '\ndeliverMessage', {
    runtimeProcessGeneration:0, ownedSessions:createOwnedSessions(()=>0), projectAttribution:()=>null, loadProjects:()=>[], cancelRuntimeStartup(){},
    resetUsageCost() {}, interruptUsage() {}, markUsageInterrupted() {},
    cancelPluginTurn, timelineGuidance, timelineRuntime, stopAgentProcess, ownCodexLauncher, Date, process: { execPath: '/fixture/node' }, app: { getAppPath: () => '/fixture/app' },
    codexCapabilityLaunch: (command: string, args: string[]) => ({ command, args }), console: { error() {} }, planSend,
    endSilence: () => null, nodeBinForHook: () => '/fixture/node',
    getAdapter: () => ({ buildArgs: () => ({ bin: '/fixture/codex', args: [], stdin: 'ignore' }) }),
    agentMcpConfigPath() {}, sessionMcpServers: () => [], codexServers: () => [], mcpEnv: () => ({}), capabilitySessionEnv: () => ({}), sessionCapabilityGuidance: () => '', revokeCapabilitySession() {}, forgetPty() {}, withAgentSecrets: (_id: string, env: unknown) => env, approvalEnv: () => ({}), PROBE_ENV: {},
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
    const restartNode = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'restartAndDeliverNow')!
    const compiled = ts.transpileModule(restartNode.getText(source).replaceAll('restartAndDeliverNow','restartAndDeliver'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    let enabled = false, snapshots = 0
    const launches: string[][] = []
    const restart = runInNewContext(compiled + '\nrestartAndDeliver', {
      runtimeProcessGeneration:0, ownedSessions:createOwnedSessions(()=>0), projectAttribution:()=>null, loadProjects:()=>[], cancelRuntimeStartup(){},
    resetUsageCost() {}, interruptUsage() {}, markUsageInterrupted() {},
    cancelPluginTurn, timelineGuidance, timelineRuntime, stopAgentProcess, ownCodexLauncher, Date, process: { execPath: '/fixture/node' }, app: { getAppPath: () => '/fixture/app' },
      codexCapabilityLaunch: (command: string, args: string[]) => ({ command, args }),
      getAdapter: () => codexAdapter, nodeBinForHook: () => '/fixture/node',
      agentMcpConfigPath() {}, codexServers: () => [],
      sessionMcpServers: () => { snapshots++; return enabled ? [{ name: 'eas-term', command: 'node', args: ['mcp.mjs'] }] : [] },
      mcpEnv: () => ({}), capabilitySessionEnv: () => ({}), sessionCapabilityGuidance: () => '', revokeCapabilitySession() {}, forgetPty() {}, withAgentSecrets: (_id: string, env: unknown) => env, approvalEnv: () => ({}), PROBE_ENV: {},
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

// 2026-09-13 用户实拍：Codex 遇到「Selected model is at capacity」带 code=1 退出，
// 界面停在「正在处理」、新消息一直排队。exit 路径缺 turn.done。
test('进程在 busy 中异常退出：先补 turn.done 再报 fatal，三支 busy 判据一次放倒', () => {
  const { live, current, events } = setup()
  live.rec.busy = true
  current.emit('exit', 1, null)
  const kinds = events.map(e => (e as { k: string }).k)
  assert.deepEqual(kinds, ['turn.done', 'error'])
  assert.equal((events[1] as { fatal: boolean }).fatal, true)
  assert.equal(live.rec.busy, false)
})

// 2026-09-14 审查：运行中心「关闭服务」走的是 ownedSessions 的 stop（killing=true），exit 时 selfKilled
// 跳过了 turn.done，渲染层 busy 卡死。判据应是「退出时还 busy」，与谁杀的无关；interrupt 自己已先把 busy 落回，不会重复。
test('我们自己杀的进程，退出时若还 busy 也要补 turn.done', () => {
  const { live, current, events } = setup()
  live.rec.busy = true
  live.killing = true
  current.emit('exit', null, 'SIGTERM')
  assert.deepEqual(events.map(e => (e as { k: string }).k), ['turn.done'], '只补 turn.done，不再报 fatal')
})

test('启动准入失败的 catch 保住 retries（自动恢复计数不能被清零）', () => {
  const src = readFileSync(new URL('./session.ts', import.meta.url), 'utf8')
  const i = src.indexOf("live.runtimeStartupId!==id || sessions.get(live.rec.id)!==live)return")
  assert.ok(i > 0)
  const block = src.slice(i, i + 500)
  assert.ok(/const retries\s*=\s*live\.rec\.retries/.test(block) && /retries\s*\}/.test(block) || /keepRetries|preserveRetries/.test(block), '启动失败路径补 turn.done 时没有保住 retries')
})
