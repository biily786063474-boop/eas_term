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
