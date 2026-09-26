import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardRead, cardAccept } from './executionPlanCardHost.ts'

test('card actions are owner-scoped and unavailable is not an empty state', async () => {
  const calls: string[] = []
  const deps = {
    resolve: (input: { senderId: number; nodeId?: string }) => {
      if (input.senderId !== 7) throw Error('会话不属于当前窗口')
      return { root: '/project', ownerKey: `node:${input.nodeId}` }
    },
    request: async (method: string, owner: { ownerKey: string }) => {
      calls.push(`${method}:${owner.ownerKey}`)
      if (owner.ownerKey !== 'node:a') return null
      return { planId: 'p', title: '计划', status: 'active', version: 1, steps: [{ stepId: 'x', title: '一', status: 'reported_done', accepted: false }] }
    }
  }
  assert.equal((await cardRead({ senderId: 7, nodeId: 'a' }, deps)).kind, 'active')
  assert.equal((await cardRead({ senderId: 7, nodeId: 'b' }, deps)).kind, 'empty')
  assert.equal((await cardAccept({ senderId: 8, nodeId: 'a', planId: 'p', stepId: 'x', accepted: true, expectedVersion: 1 }, deps)).kind, 'unavailable')
  assert.deepEqual(calls, ['host/card-read:node:a', 'host/card-read:node:b'])
})

test('cannot accept stale or foreign plan', async () => {
  const deps = {
    resolve: () => ({ root: '/project', ownerKey: 'node:a' }),
    request: async () => ({ planId: 'own', title: 'A', status: 'active', version: 2, steps: [{ stepId: 'x', title: '一', status: 'reported_done', accepted: false }] })
  }
  assert.equal((await cardAccept({ senderId: 7, nodeId: 'a', planId: 'foreign', stepId: 'x', accepted: true, expectedVersion: 2 }, deps)).kind, 'unavailable')
  assert.equal((await cardAccept({ senderId: 7, nodeId: 'a', planId: 'own', stepId: 'x', accepted: true, expectedVersion: 1 }, deps)).kind, 'unavailable')
})

test('last acceptance completes only when the owned AI session is idle', async () => {
  const flags: boolean[] = []
  const card = { planId: 'p', title: 'A', status: 'active', version: 1, steps: [{ stepId: 'x', title: '一', status: 'reported_done', accepted: false }] }
  const deps = (busy: boolean) => ({
    resolve: () => ({ root: '/project', ownerKey: 'node:a' }),
    isBusy: () => busy,
    request: async (method: string, _owner: unknown, args?: Record<string, unknown>) => {
      if (method === 'host/card-accept') flags.push(args?.completeNow === true)
      return card
    }
  })
  await cardAccept({ senderId: 7, nodeId: 'a', planId: 'p', stepId: 'x', accepted: true, expectedVersion: 1 }, deps(true))
  await cardAccept({ senderId: 7, nodeId: 'a', planId: 'p', stepId: 'x', accepted: true, expectedVersion: 1 }, deps(false))
  assert.deepEqual(flags, [false, true])
})
