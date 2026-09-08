import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RequestJournal, isUnsupportedDirectorySync } from './capabilityRequestJournal.ts'

const operation = { scope: 'bizone', project: '/project', tool: 'generate', nodeId: 'node1', arguments: { prompt: 'hello', count: 1 } }
test('Windows only skips known directory fsync limitations, never I/O or space failures', () => {
  for (const code of ['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP']) {
    assert.equal(isUnsupportedDirectorySync({ code }, 'win32'), true)
    assert.equal(isUnsupportedDirectorySync({ code }, 'darwin'), false)
  }
  for (const code of ['EIO', 'ENOSPC', 'ENOENT', 'EACCES']) {
    assert.equal(isUnsupportedDirectorySync({ code }, 'win32'), false)
  }
})
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'request-journal-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, path: join(dir, 'capability-requests', 'journal.json'), journal: new RequestJournal(dir) }
}
test('submitting is durable before dispatch and crash after acceptance blocks restart/re-RPC', t => {
  const { journal, dir, path } = fixture(t)
  let accepted = 0
  const rpc = (_rpcId: number, j: RequestJournal) => {
    const decision = j.begin('logical-1', operation)
    if (decision.action === 'submit') {
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).entries[0].state, 'submitting')
      accepted++ // Server accepted; client crashes before response.
    }
    return decision
  }
  assert.equal(rpc(1, journal).action, 'submit')
  const restarted = new RequestJournal(dir)
  assert.deepEqual(rpc(999, restarted), { action: 'blocked', state: 'unknown' })
  assert.equal(accepted, 1)
  assert.equal(statSync(path).mode & 0o777, 0o600)
})
test('concurrent begin permits one dispatch and stable key ordering gives cache', async t => {
  const { journal, dir } = fixture(t)
  const other = new RequestJournal(dir)
  const decisions = await Promise.all([journal, other, journal].map(async j => j.begin('id', operation)))
  assert.equal(decisions.filter(d => d.action === 'submit').length, 1)
  journal.reconcile('id', operation, { taskId: 'paid-task' })
  assert.deepEqual(other.begin('id', { ...operation, arguments: { count: 1, prompt: 'hello' } }), {
    action: 'cached', state: 'completed', result: { taskId: 'paid-task' }
  })
})
test('timeout stays unknown; only explicit reliable reconciliation unlocks cached result', t => {
  const { journal } = fixture(t)
  journal.begin('id', operation)
  journal.markUnknown('id', operation)
  assert.equal(journal.begin('id', operation).action, 'blocked')
  journal.reconcile('id', operation, { taskId: 'server-task' })
  assert.equal(journal.begin('id', operation).action, 'cached')
})
test('same logical ID with changed parameters or project is rejected', t => {
  const { journal } = fixture(t)
  journal.begin('id', operation)
  for (const changed of [{ ...operation, project: '/other' }, { ...operation, arguments: { count: 2 } }]) {
    assert.throws(() => journal.begin('id', changed), /mismatch/)
    assert.throws(() => journal.complete('id', changed, {}), /mismatch/)
  }
})
test('completed results persist and arguments/secrets are not stored', t => {
  const { journal, path, dir } = fixture(t)
  const op = { ...operation, arguments: { token: 'SECRET_TOKEN' } }
  journal.begin('id', op)
  journal.complete('id', op, { taskId: 'task' })
  assert.equal(readFileSync(path, 'utf8').includes('SECRET_TOKEN'), false)
  assert.equal(new RequestJournal(dir).begin('id', op).action, 'cached')
  assert.throws(() => journal.complete('id', op, { token: 'SECRET_TOKEN' }), /secret/i)
})
test('corrupt or structurally invalid journals fail closed, including live corruption', t => {
  const { journal, dir, path } = fixture(t)
  journal.begin('id', operation)
  for (const value of ['broken', '{}', '{"version":1,"entries":[{}]}']) {
    writeFileSync(path, value)
    assert.throws(() => new RequestJournal(dir), /journal/i)
    assert.throws(() => journal.begin('fresh', operation), /journal/i)
  }
})
test('persists node/task lookup identity and fails closed if a live ledger disappears', t => {
  const { journal, path } = fixture(t)
  journal.begin('id', { ...operation, taskId: 'task1' })
  const entry = JSON.parse(readFileSync(path, 'utf8')).entries[0]
  assert.equal(entry.nodeId, 'node1')
  assert.equal(entry.taskId, 'task1')
  rmSync(path)
  assert.throws(() => journal.begin('id', operation), /journal/i)
})
