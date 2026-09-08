import test from 'node:test'
import assert from 'node:assert/strict'
import { CapabilitySessions } from './capabilitySessions.ts'

test('lease context is copied and cannot be supplied by an RPC caller', () => {
  const sessions = new CapabilitySessions('instance-a', 'generation-a')
  const context = { project: '/项目 空格', ptyId: 'pty-a', agentSessionId: 'chat-a' }
  const lease = sessions.issue(context)
  context.project = '/other'
  const resolved = sessions.authenticate(lease)
  assert.equal(resolved.project, '/项目 空格')
  resolved.project = '/changed'
  assert.equal(sessions.authenticate(lease).project, '/项目 空格')
  assert.throws(() => sessions.authenticate({ ...lease, secret: 'forged' }))
  assert.throws(() => sessions.authenticate({ ...lease, instanceId: 'instance-b' }))
  assert.throws(() => sessions.authenticate({ ...lease, generation: 'generation-b' }))
})

test('each invocation has an independent lease; revoking parent revokes all children', () => {
  const sessions = new CapabilitySessions('a', 'g')
  const parent = sessions.issue({ ptyId: 'pty-a', project: '/initial' }, 'launcher')
  const first = sessions.issueChild(parent, { project: '/first' })
  const second = sessions.issueChild(parent, { project: '/second' })
  assert.equal(sessions.authenticate(first).ptyId, 'pty-a')
  assert.equal(sessions.authenticate(second).project, '/second')
  sessions.revoke(first.id)
  assert.throws(() => sessions.authenticate(first))
  assert.equal(sessions.authenticate(second).project, '/second')
  assert.throws(() => sessions.authenticate(parent))
  assert.throws(() => sessions.issueChild(second, { project: '/forged' }))
  sessions.revoke(parent.id)
  assert.throws(() => sessions.authenticate(second))
  assert.throws(() => sessions.issueChild(parent, { project: '/new' }))
})

test('lease cannot cross application generations, even for same instance locator', () => {
  const before = new CapabilitySessions('a', 'before')
  const lease = before.issue({ agentSessionId: 's' })
  const after = new CapabilitySessions('a', 'after')
  assert.throws(() => after.authenticate(lease))
  before.revokeAll()
  assert.throws(() => before.authenticate(lease))
})

test('revoke returns exactly the live parent and child IDs, isolating other PTYs and repeat calls', () => {
  const sessions = new CapabilitySessions('instance', 'generation')
  const firstParent = sessions.issue({ ptyId: 'pty-first' }, 'launcher')
  const secondParent = sessions.issue({ ptyId: 'pty-second' }, 'launcher')
  const first = sessions.issueChild(firstParent, { project: '/first' })
  const second = sessions.issueChild(firstParent, { project: '/second' })
  const third = sessions.issueChild(firstParent, { project: '/third' })
  const other = sessions.issueChild(secondParent, { project: '/other' })
  assert.deepEqual(sessions.revoke(first.id), [first.id])
  assert.deepEqual(sessions.revoke(first.id), [])
  assert.deepEqual(new Set(sessions.revoke(firstParent.id)), new Set([firstParent.id, second.id, third.id]))
  assert.deepEqual(sessions.revoke(firstParent.id), [])
  assert.deepEqual(sessions.revoke('nonexistent'), [])
  for (const child of [first, second, third]) assert.throws(() => sessions.authenticate(child))
  assert.equal(sessions.authenticate(other).ptyId, 'pty-second')
  const another = sessions.issueChild(secondParent, { project: '/another' })
  assert.deepEqual(new Set(sessions.revoke(secondParent.id)), new Set([secondParent.id, other.id, another.id]))
  assert.throws(() => sessions.authenticate(other))
})
test('launcher closes only its own invocation, without releasing a sibling', () => {
  const sessions = new CapabilitySessions('instance', 'generation')
  const a = sessions.issue({ ptyId: 'a' }, 'launcher'), b = sessions.issue({ ptyId: 'b' }, 'launcher')
  const first = sessions.issueChild(a, { project: '/first' }), second = sessions.issueChild(a, { project: '/second' })
  assert.throws(() => sessions.revokeChild(b, first.id))
  assert.deepEqual(sessions.revokeChild(a, first.id), [first.id])
  assert.deepEqual(sessions.revokeChild(a, first.id), [])
  assert.equal(sessions.authenticate(second).ptyId, 'a')
})
