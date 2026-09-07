import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModelList, toOption } from './codexModels.ts'

test('toOption：displayName 当标签，缺了退回 id', () => {
  assert.deepEqual(toOption({ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' }), { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' })
  assert.deepEqual(toOption({ id: 'x' }), { id: 'x', label: 'x' })
  assert.equal(toOption({ displayName: '没有 id' }), null)
  assert.equal(toOption(null), null)
})

test('parseModelList：真实形状（app-server model/list 的实测返回）', () => {
  const real = {
    data: [
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', defaultReasoningEffort: 'low' },
      { id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra' },
      { id: 'gpt-5.5', displayName: 'GPT-5.5' }
    ]
  }
  assert.deepEqual(parseModelList(real).map((m) => m.id), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'])
})

test('parseModelList：重复 id 去重；坏数据不抛', () => {
  assert.deepEqual(parseModelList({ data: [{ id: 'a' }, { id: 'a' }, null, 'x', { }] }).map((m) => m.id), ['a'])
  assert.deepEqual(parseModelList(undefined), [])
  assert.deepEqual(parseModelList({ data: '不是数组' }), [])
})

import { listCodexModels, resetCodexModelsCache } from './codexModels.ts'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROBE_ENV } from '../probeEnv.ts'

function fixture(t: { after(fn: () => void): void }, mode = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'eas-model-probe-'))
  const bin = join(dir, 'codex')
  const log = join(dir, 'log')
  writeFileSync(bin, `#!${process.execPath}\n` + readFileSync(new URL('./__fixtures__/fake-model-server.cjs', import.meta.url), 'utf8'))
  chmodSync(bin, 0o755)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { bin, env: { ...process.env, FAKE_MODE: mode, FAKE_LOG: log }, timeoutMs: 10000, log }
}

test('model effort metadata is normalized without adding absent fields', () => {
  assert.deepEqual(toOption({ id: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'high', description: 'Thorough' }], defaultReasoningEffort: 'high' }), { id: 'a', label: 'a', effortLevels: [{ id: 'low', label: 'Fast' }, { id: 'high', label: 'Thorough' }], defaultEffort: 'high' })
})

test('real stdio: initialized notification precedes model/list; collects pages', async (t) => {
  resetCodexModelsCache()
  const opts = fixture(t)
  assert.deepEqual(await listCodexModels(opts), [{ id: 'first', label: 'first' }, { id: 'second', label: 'second' }])
  assert.deepEqual(readFileSync(opts.log, 'utf8').trim().split('\n').map(s => JSON.parse(s).method), ['initialize', 'initialized', 'model/list', 'model/list'])
})

test('cache separates source, coalesces requests and supports force and expiry', async (t) => {
  resetCodexModelsCache()
  const a = fixture(t), b = fixture(t, 'single')
  await Promise.all([listCodexModels(a), listCodexModels(a)])
  assert.equal(readFileSync(a.log, 'utf8').trim().split('\n').length, 4)
  await listCodexModels(a)
  assert.deepEqual(await listCodexModels(b), [{ id: 'single', label: 'single' }])
  await listCodexModels({ ...a, force: true })
  assert.equal(readFileSync(a.log, 'utf8').trim().split('\n').length, 8)
  const now = Date.now
  Date.now = () => now() + 120_000
  try { await listCodexModels(a) } finally { Date.now = now }
  assert.equal(readFileSync(a.log, 'utf8').trim().split('\n').length, 12)
})

for (const mode of ['init-error', 'list-error', 'malformed', 'bad-result', 'loop', 'timeout', 'exit', 'close-input']) {
  test(`real stdio failure: ${mode}`, async (t) => {
    resetCodexModelsCache()
    assert.equal(await listCodexModels(fixture(t, mode)), undefined)
  })
}

test('default environment uses shared probe PATH', async (t) => {
  resetCodexModelsCache()
  const opts = fixture(t, 'single')
  const old = { ...PROBE_ENV }
  Object.assign(PROBE_ENV, opts.env, { PATH: opts.bin.slice(0, opts.bin.lastIndexOf('/')) })
  try { assert.deepEqual(await listCodexModels({ timeoutMs: 10000 }), [{ id: 'single', label: 'single' }]) }
  finally { for (const key of Object.keys(PROBE_ENV)) delete PROBE_ENV[key]; Object.assign(PROBE_ENV, old) }
})

test('timeout kills an uncooperative probe process', async (t) => {
  resetCodexModelsCache()
  const opts = fixture(t, 'stubborn')
  assert.equal(await listCodexModels({ ...opts, timeoutMs: 4000 }), undefined)
  const pid = Number(readFileSync(opts.log + '.pid', 'utf8'))
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('missing binary returns undefined and failed probes are retried', async (t) => {
  resetCodexModelsCache()
  assert.equal(await listCodexModels({ bin: '/nonexistent/eas-fake-codex' }), undefined)
  const opts = fixture(t, 'init-error')
  await listCodexModels(opts)
  await listCodexModels(opts)
  assert.equal(readFileSync(opts.log, 'utf8').trim().split('\n').length, 2)
})
