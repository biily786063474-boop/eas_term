import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import ts from 'typescript'
import { assembleCapabilityServers } from '../shared/builtinCapabilities.ts'
import { capabilityMcpConfig } from './selectedCapabilityServers.ts'
import { writeCapabilitySnapshot } from './capabilitySnapshot.ts'
import { readMcpServers } from './agentChat/omp/launch.ts'
import { codexAddServerArgs } from '../shared/roleBinding.ts'
import { executionPlanGuidance } from './executionPlanGuidance.ts'

test('only enabled managed conversations receive a short same-turn plan instruction', () => {
  assert.equal(executionPlanGuidance(false), '')
  const guidance = executionPlanGuidance(true)
  assert.match(guidance, /同轮调用 plan_create/)
  assert.match(guidance, /plan_get\/step_update/)
  assert.match(guidance, /普通问答和单步操作无需建计划/)
})

test('background plan server composes with board/timeline, but disabled state and PTY base stay unchanged', () => {
  const source = ts.createSourceFile('mcpBridge.ts', fs.readFileSync(new URL('./mcpBridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const node = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'managedSessionMcpServers') as ts.FunctionDeclaration
  assert.ok(node, '受管会话应有独立的基础插件装配函数')
  let enabled = true
  const base = [{ name: 'eas-term', command: 'node', args: ['workbench.mjs'] }]
  const selected = (id?: string) => [...base, ...(id ? [{ name: id.slice(4), command: 'node', args: ['selected.mjs'] }] : [])]
  const managed = vm.runInNewContext(ts.transpileModule(node.getText(source).replace(/^export /, '') + '\nmanagedSessionMcpServers', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    sessionMcpServers: selected,
    executionPlanEnabled: () => enabled,
    easPluginMcpServer: () => ({ name: 'execution-plan', command: 'node', args: ['plan-shim.mjs'], env: { EAS_PLUGIN: 'execution-plan' } }),
    assembleCapabilityServers
  }) as (id?: string) => { name: string; command: string; args: string[] }[]
  assert.deepEqual(managed().map(s => s.name), ['eas-term', 'execution-plan'])
  assert.deepEqual(managed('eas:board').map(s => s.name), ['eas-term', 'board', 'execution-plan'])
  assert.deepEqual(managed('eas:timeline').map(s => s.name), ['eas-term', 'timeline', 'execution-plan'])
  assert.deepEqual(selected().map(s => s.name), ['eas-term'], '终端 PTY 原函数不带执行清单')
  enabled = false
  assert.deepEqual(managed('eas:board').map(s => s.name), ['eas-term', 'board'])
})

test('same managed snapshot reaches Claude JSON, OMP ACP and Codex command config', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-plan-mcp-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const servers = assembleCapabilityServers([{ enabled: true, server: { name: 'eas-term', command: 'node' } }], [{ name: 'execution-plan', command: process.execPath, args: [path.resolve('mcp/eas-plugin-shim.mjs')], env: { EAS_PLUGIN: 'execution-plan' }, envVars: ['EAS_TERM_PORT', 'EAS_TERM_TOKEN', 'EAS_CAPABILITY_LEASE'] }])
  const json = capabilityMcpConfig(servers)
  const snapshot = writeCapabilitySnapshot(root, 'managed-session', json)
  assert.ok(Object.hasOwn(json, 'execution-plan'))
  assert.ok(readMcpServers(snapshot).servers.some(s => s.name === 'execution-plan'))
  assert.ok(codexAddServerArgs(servers[1]).some(arg => arg.includes('execution-plan')))
})
