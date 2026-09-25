import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { assembleCapabilityServers } from '../../shared/builtinCapabilities.ts'
import { capabilityMcpConfig } from '../selectedCapabilityServers.ts'
import { writeCapabilitySnapshot } from '../capabilitySnapshot.ts'
import { readMcpServers } from './omp/launch.ts'
import { codexAddServerArgs } from '../../shared/roleBinding.ts'
// @ts-expect-error Bundled stdio plugin store is intentionally plain .mjs without a TS declaration.
import { createPlan, updateStep, acceptStep, getPlan, listPlans } from '../../../resources/plugins/execution-plan/lib/store.mjs'

// fsGuard has legacy extensionless imports; isolate the real snapshot reader for bare node --test.
const snapshotSource = ts.createSourceFile('executionPlanSnapshot.ts', fs.readFileSync(new URL('../executionPlanSnapshot.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const snapshotNodes = snapshotSource.statements.filter(s => (ts.isVariableStatement(s) && s.declarationList.declarations.some(d => ['MAX_BYTES', 'STATUSES', 'record'].includes(d.name.getText(snapshotSource)))) || (ts.isFunctionDeclaration(s) && s.name?.text === 'latestExecutionPlan'))
const snapshotCode = snapshotNodes.map(s => s.getText(snapshotSource).replace(/^export /, '')).join('\n') + '\nlatestExecutionPlan'
const latestExecutionPlan = vm.runInNewContext(ts.transpileModule(snapshotCode, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
  fs, path, Set, JSON,
  projectRootOf: (cwd: string) => cwd,
  guardDir: (cwd: string) => ({ ok: fs.existsSync(cwd), path: cwd }),
  guardPath: (file: string) => ({ ok: true, path: file })
}) as (cwd: string) => { planId: string; done: number; total: number; currentTitle: string; version: number } | null

test('managed Claude/Codex/OMP snapshots retain selected business plugin and add only enabled plan service', t => {
  const source = ts.createSourceFile('mcpBridge.ts', fs.readFileSync(new URL('../mcpBridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const declarations = source.statements.filter(s => ts.isFunctionDeclaration(s) && ['managedSessionMcpServers', 'easPluginMcpServer', 'executionPlanEnabled'].includes(s.name?.text ?? '')).map(s => s.getText(source).replace(/^export /, '')).join('\n')
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-plan-integration-'))
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }))
  let enabled = true
  const plugins = new Map([
    ['eas:board', { id: 'eas:board', name: 'board', cli: 'eas', mcp: true }],
    ['eas:timeline', { id: 'eas:timeline', name: 'timeline', cli: 'eas', mcp: true }],
    ['eas:execution-plan', { id: 'eas:execution-plan', name: 'execution-plan', cli: 'eas', mcp: true }]
  ])
  const runtime = vm.runInNewContext(ts.transpileModule(declarations + '\n({managedSessionMcpServers})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    sessionMcpServers: (id?: string) => [{ name: 'eas-term', command: 'node', args: ['base'] }, ...(id ? [{ name: id.slice(4), command: 'node', args: ['selected'] }] : [])],
    findPlugin: (id: string) => plugins.get(id), pluginIdEnabled: () => enabled,
    runnerFor: (args: string[]) => ({ command: process.execPath, args }), pluginShimPath: () => path.resolve('mcp/eas-plugin-shim.mjs'), assembleCapabilityServers
  }) as { managedSessionMcpServers(id?: string): { name: string; command: string; args: string[] }[] }
  for (const selected of ['eas:board', 'eas:timeline']) {
    const servers = runtime.managedSessionMcpServers(selected)
    assert.deepEqual(servers.map(s => s.name), ['eas-term', selected.slice(4), 'execution-plan'])
    const snapshot = writeCapabilitySnapshot(fixture, selected, capabilityMcpConfig(servers))
    assert.ok(readMcpServers(snapshot).servers.some(s => s.name === 'execution-plan'), 'OMP config sees background plan server')
    assert.ok(codexAddServerArgs(servers[2]).some(arg => arg.includes('execution-plan')), 'Codex args see plan server')
    assert.ok(Object.hasOwn(capabilityMcpConfig(servers), 'execution-plan'), 'Claude config sees plan server')
  }
  enabled = false
  assert.deepEqual(runtime.managedSessionMcpServers('eas:board').map(s => s.name), ['eas-term', 'board'])
})

test('create, advance and user-accept survive reread; snapshot is read-only and ignores damaged data', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-plan-persist-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const identity = { sessionId: 's', turnId: 't' }
  const created = await createPlan(cwd, identity, { title: '字幕同步', steps: [{ title: '定位', criterion: '复现' }, { title: '验收', criterion: '倍速' }] })
  const done = await updateStep(cwd, identity, { planId: created.planId, stepId: created.steps[0].stepId, status: 'reported_done', expectedVersion: created.version })
  const accepted = await acceptStep(cwd, { planId: created.planId, stepId: created.steps[0].stepId, accepted: true, expectedVersion: done.version })
  assert.equal((await getPlan(cwd, created.planId)).steps[0].accepted, true)
  assert.equal((await listPlans(cwd)).items[0].done, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(latestExecutionPlan(cwd))), { planId: created.planId, done: 1, total: 2, currentTitle: '验收', version: accepted.version })
  const file = path.join(cwd, '.eas', 'execution-plans.json')
  const before = fs.readFileSync(file, 'utf8')
  assert.equal(latestExecutionPlan(cwd)?.planId, created.planId)
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'rehydration never writes project data')
  fs.writeFileSync(file, '{damaged')
  assert.equal(latestExecutionPlan(cwd), null)
  assert.equal(fs.readFileSync(file, 'utf8'), '{damaged', 'bad data must not be overwritten')
})
