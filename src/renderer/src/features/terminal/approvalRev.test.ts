import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stampApprovalRev, islandApprovalMatches } from './approvalRev.ts'

const ask = (question: string) => ({ question, body: 'rm -rf build', options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }], dangerous: false })

test('re-detecting the same prompt keeps its revision; a different prompt gets a new one', () => {
  const a = stampApprovalRev(undefined, ask('Proceed?'))
  assert.ok(a.rev)
  assert.equal(stampApprovalRev(a, ask('Proceed?')).rev, a.rev)
  assert.notEqual(stampApprovalRev(a, ask('Overwrite file?')).rev, a.rev)
})

test('the same text asked again after the old one was cleared is a new request', () => {
  const a = stampApprovalRev(undefined, ask('Proceed?'))
  const b = stampApprovalRev(undefined, ask('Proceed?'))
  assert.notEqual(a.rev, b.rev)
})

test('island click must carry the revision it was rendered from', () => {
  const ap = stampApprovalRev(undefined, ask('Proceed?'))
  assert.equal(islandApprovalMatches(ap, { type: 'approve', key: 'p', choice: 1, rev: ap.rev }), true)
  assert.equal(islandApprovalMatches(ap, { type: 'approve', key: 'p', choice: 1 }), false)
  assert.equal(islandApprovalMatches(ap, { type: 'approve', key: 'p', choice: 1, rev: 'old' }), false)
  assert.equal(islandApprovalMatches(ap, { type: 'approve', key: 'p', choice: 3, rev: ap.rev }), false)
  assert.equal(islandApprovalMatches({ ...ap, dangerous: true }, { type: 'approve', key: 'p', choice: 1, rev: ap.rev }), false)
  assert.equal(islandApprovalMatches(undefined, { type: 'approve', key: 'p', choice: 1, rev: ap.rev }), false)
})

test('click-time live screen check catches an in-place prompt swap the rev cannot see', async () => {
  const { registerLiveApproval, liveApproval } = await import('./approvalRev.ts')
  const a = stampApprovalRev(undefined, ask('Proceed?'))
  assert.deepEqual(liveApproval('p9', a), { state: 'unknown' }) // no mounted terminal → caller falls back to rev
  let screen: ReturnType<typeof ask> | null = ask('Proceed?')
  const off = registerLiveApproval('p9', () => screen)
  assert.deepEqual(liveApproval('p9', a), { state: 'same' })
  screen = ask('Delete database?') // CLI swapped the prompt without a spinner turn
  assert.deepEqual(liveApproval('p9', a), { state: 'changed', live: screen })
  screen = null // box gone
  assert.deepEqual(liveApproval('p9', a), { state: 'changed', live: null })
  off()
  assert.deepEqual(liveApproval('p9', a), { state: 'unknown' })
})

test('a resize that only moves wrap points is still the same approval', async () => {
  const { registerLiveApproval, liveApproval } = await import('./approvalRev.ts')
  const a = stampApprovalRev(undefined, { ...ask('Proceed?'), body: 'rm -rf bui ld' })
  const off = registerLiveApproval('p10', () => ({ ...ask('Proceed?'), body: 'rm -rf build' }))
  assert.deepEqual(liveApproval('p10', a), { state: 'same' })
  off()
})
