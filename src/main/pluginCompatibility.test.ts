import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as compat from './pluginCompatibility.ts'
const host = { version: '0.4.102', platform: 'darwin', architecture: 'arm64', capabilities: ['mcp.stdio'] }
test('legacy requirements absent is supported', () => {
  assert.deepEqual(compat.parsePluginRequirements(undefined), { ok: true, requirements: undefined })
  assert.deepEqual(compat.checkPluginCompatibility(undefined, host), { ok: true })
})
test('requirements fail closed on malformed or unknown constraints', () => {
  for (const raw of [null, [], 'x', {minHostVersion:'v1'}, {minHostVersion:'01.2.3'}, {platforms:[]}, {platforms:['unknown']}, {architectures:[1]}, {capabilities:['']}, {capabilities:['x','x']}, {futureConstraint:true}]) {
    assert.equal(compat.parsePluginRequirements(raw).ok, false, JSON.stringify(raw))
  }
})
test('valid constraints are preserved without sharing mutable arrays', () => {
  const raw = { minHostVersion:'0.4.100', platforms:['darwin'], architectures:['arm64'], capabilities:['mcp.stdio'] }
  const r = compat.parsePluginRequirements(raw)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.requirements, raw)
  raw.platforms.push('win32')
  assert.deepEqual(r.requirements?.platforms, ['darwin'])
})
test('numeric version comparison and host validation', () => {
  for (const version of ['0.4.103','0.5.0','1.0.0']) assert.equal(compat.checkPluginCompatibility({minHostVersion:version}, host).ok,false)
  for (const version of ['0.4.9','0.4.102','0.3.999']) assert.equal(compat.checkPluginCompatibility({minHostVersion:version}, host).ok,true)
  assert.equal(compat.checkPluginCompatibility({minHostVersion:'0.1.0'}, {...host,version:'bad'}).ok,false)
})
test('platform, architecture and capabilities all gate support', () => {
  for (const requirements of [{platforms:['win32']},{architectures:['x64']},{capabilities:['mcp.remote']}]) {
    assert.equal(compat.checkPluginCompatibility(requirements,host).ok,false)
  }
  assert.equal(compat.checkPluginCompatibility({platforms:['darwin'],architectures:['arm64'],capabilities:['mcp.stdio']},host).ok,true)
})

test('package and directory requirements must match semantically and support this host', () => {
  assert.equal(compat.checkPackageRequirements(undefined, undefined, host).ok,true)
  assert.equal(compat.checkPackageRequirements({capabilities:['mcp.remote']}, undefined, host).ok,false)
  assert.equal(compat.checkPackageRequirements(undefined, {capabilities:['mcp.remote']}, host).ok,false)
  assert.equal(compat.checkPackageRequirements({platforms:['darwin','win32']}, {platforms:['win32','darwin']}, host).ok,true)
  assert.equal(compat.checkPackageRequirements({future:true}, undefined, host).ok,false)
  assert.equal(compat.checkPackageRequirements({capabilities:['mcp.remote']}, {capabilities:['mcp.remote']}, host).ok,false)
})
