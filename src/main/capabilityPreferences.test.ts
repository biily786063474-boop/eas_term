import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityPreferenceStore, parseCapabilityBundle, readCapabilityBundle } from './capabilityPreferences.ts'
const on = { workbench: true, bizone: true, guidance: true }
const off = { workbench: false, bizone: false, guidance: false }
function root(t: { after: (fn: () => void) => void }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cap-prefs-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
test('fresh defaults and legacy mappings persist without reopening a user-disabled module', t => {
  for (const [legacy, expected] of [
    [{}, on], [{ legacyMcpOptOut: true }, { ...on, workbench: false, bizone: false }],
    [{ legacyGuidanceMuted: true }, { ...on, guidance: false }],
    [{ legacyMcpOptOut: true, legacyGuidanceMuted: true }, off]
  ] as const) {
    const dir = root(t)
    const store = new CapabilityPreferenceStore(dir, legacy)
    assert.deepEqual(store.read(), { preferences: expected })
    assert.deepEqual(new CapabilityPreferenceStore(dir).read(), { preferences: expected })
    assert.equal(statSync(join(dir, 'capability-preferences.json')).mode & 0o777, 0o600)
  }
})
test('every module changes independently and survives restart; invalid input cannot write', t => {
  const dir = root(t)
  const store = new CapabilityPreferenceStore(dir)
  for (const module of ['workbench', 'bizone', 'guidance'] as const) {
    assert.deepEqual(store.set(module, false).preferences, { ...on, [module]: false })
    assert.deepEqual(new CapabilityPreferenceStore(dir).read().preferences, { ...on, [module]: false })
    store.set(module, true)
  }
  const before = readFileSync(join(dir, 'capability-preferences.json'), 'utf8')
  assert.throws(() => store.set('business' as 'workbench', false))
  assert.throws(() => store.set('workbench', 'false' as unknown as boolean))
  assert.equal(readFileSync(join(dir, 'capability-preferences.json'), 'utf8'), before)
})
test('corrupt, malformed and future schemas fail closed and never reset on set or restart', t => {
  const dir = root(t)
  const path = join(dir, 'capability-preferences.json')
  for (const content of ['broken', '{}', JSON.stringify({ schemaVersion: 2, ...on }), JSON.stringify({ schemaVersion: 1, ...on, bizone: 'yes' })]) {
    writeFileSync(path, content)
    const store = new CapabilityPreferenceStore(dir)
    assert.deepEqual(store.read().preferences, off)
    assert.ok(store.read().error)
    assert.ok(store.set('workbench', true).error)
    assert.equal(readFileSync(path, 'utf8'), content)
  }
})
test('schema 1 extra preference fields are ignored and only known fields written', t => {
  const dir = root(t)
  const path = join(dir, 'capability-preferences.json')
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, ...on, obsolete: true }))
  const store = new CapabilityPreferenceStore(dir)
  assert.deepEqual(store.read().preferences, on)
  store.set('bizone', false)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { schemaVersion: 1, ...on, bizone: false })
})
test('bundled schema is valid; wrong bindings, duplicates, extra commands, and unsupported schemas reject', () => {
  const bundle = readCapabilityBundle(join(process.cwd(), 'resources/plugins/eas-capabilities/bundle.json'))
  assert.equal(bundle.id, 'eas-capabilities')
  assert.equal(bundle.modules.length, 3)
  for (const bad of [
    { ...bundle, schemaVersion: 2 }, { ...bundle, id: 'other' }, { ...bundle, version: '' },
    { ...bundle, command: 'danger' }, { ...bundle, modules: [...bundle.modules, bundle.modules[0]] },
    { ...bundle, modules: bundle.modules.slice(1) },
    { ...bundle, modules: bundle.modules.map(m => ({ ...m, binding: 'other' })) },
    { ...bundle, modules: bundle.modules.map(m => ({ ...m, command: 'danger' })) }
  ]) assert.throws(() => parseCapabilityBundle(bad), /bundle/i)
})
