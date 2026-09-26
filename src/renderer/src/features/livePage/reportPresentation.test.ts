import test from 'node:test'
import assert from 'node:assert/strict'
import { reportForLeaf, publishReport, clearReports } from './reportAssociation.ts'
import { hasDualPresentation } from './reportPresentation.ts'

test('dual presentation requires a live page and report from the same leaf', () => {
  clearReports()
  const frames = [{ id: 'f', nodes: [{ id: 'r', pane: { kind: 'web', url: 'file:///r.html' } }] }]
  publishReport({ leafId: 'a', frameId: 'f', nodeId: 'r', url: 'file:///r.html' })
  assert.ok(reportForLeaf('a', frames))
  assert.equal(reportForLeaf('b', frames), undefined)
  assert.equal(hasDualPresentation({ leafId: 'a', visible: true, popout: false }, reportForLeaf('a', frames)), true)
  assert.equal(hasDualPresentation({ leafId: 'b', visible: true, popout: false }, reportForLeaf('a', frames)), false)
  assert.equal(hasDualPresentation(undefined, reportForLeaf('a', frames)), false)
})
