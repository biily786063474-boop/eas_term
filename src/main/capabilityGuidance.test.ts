import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCapabilityGuidance } from './capabilityGuidance.ts'

test('guidance is session-scoped, short, conditional and never equates installed with connected', () => {
  const options = { preferences: { workbench: true, bizone: true, guidance: true }, directory: '/安装 包/指引', version: '1', bizoneInstalled: false }
  const text = buildCapabilityGuidance(options)
  assert.match(text, /依赖未找到/)
  assert.match(text, /实际工具清单/)
  assert.match(text, /安装 包/)
  assert.ok(text.length < 800)
  assert.equal(buildCapabilityGuidance({ ...options, preferences: { ...options.preferences, guidance: false } }), '')
  assert.match(buildCapabilityGuidance({ ...options, preferences: { ...options.preferences, workbench: false, bizone: false } }), /工作台模块已禁用/)
  assert.doesNotMatch(buildCapabilityGuidance({ ...options, preferences: { ...options.preferences, workbench: false, bizone: false } }), /canvas\.md/)
})
