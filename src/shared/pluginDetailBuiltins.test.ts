import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { resolvePluginDetail } from './pluginDetailBuiltins.ts'

test('all eight reviewed marketplace details bind to exact immutable published package identity', () => {
  const root = path.resolve('resources/plugin-market-details')
  const names = fs.readdirSync(root).filter(name => name.endsWith('.json'))
  assert.equal(names.length, 8)
  for (const name of names) {
    const entry = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
    assert.equal(name, `${entry.name}.json`)
    const selected = resolvePluginDetail({ name: entry.name, version: entry.version, sha256: entry.sha256 })
    assert.equal(selected?.summary, entry.detail.summary)
    assert.ok(selected?.capabilities?.length)
    assert.equal(resolvePluginDetail({ name: entry.name, version: entry.version, sha256: '0'.repeat(64) }), undefined)
    assert.equal(resolvePluginDetail({ name: entry.name, version: '9.9.9', sha256: entry.sha256 }), undefined)
  }
})
