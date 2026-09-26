import test from 'node:test'
import assert from 'node:assert/strict'
import { publishReport, reportForLeaf, clearReports, clearReportForLeaf, manualReportForNode } from './reportAssociation.ts'

const frames = [{ id: 'frame-a', nodes: [{ id: 'report-a', pane: { kind: 'web', url: 'file:///project/report.html' } }] }]

test('report identity is explicit, leaf-scoped and disappears when its node is removed', () => {
  clearReports()
  publishReport({ leafId: 'agent-a', frameId: 'frame-a', nodeId: 'report-a', url: 'file:///project/report.html' })
  assert.equal(reportForLeaf('agent-a', frames)?.nodeId, 'report-a')
  assert.equal(reportForLeaf('agent-b', frames), undefined)
  assert.equal(reportForLeaf('agent-a', [{ id: 'frame-a', nodes: [] }]), undefined)
  assert.equal(reportForLeaf('agent-a', [{ id: 'frame-a', nodes: [{ id: 'report-a', pane: { kind: 'web', url: 'file:///project/other.html' } }] }]), undefined)
})

test('ending one live session clears only its report association', () => {
  clearReports()
  publishReport({ leafId: 'agent-a', frameId: 'frame-a', nodeId: 'report-a', url: 'file:///project/report.html' })
  publishReport({ leafId: 'agent-b', frameId: 'frame-a', nodeId: 'report-a', url: 'file:///project/report.html' })
  clearReportForLeaf('agent-a')
  assert.equal(reportForLeaf('agent-a', frames), undefined)
  assert.ok(reportForLeaf('agent-b', frames))
})

test('manual marking only accepts a report node in the active AI leaf Frame', () => {
  const local = [{ id: 'f', nodes: [{ id: 'agent', leafId: 'leaf-a', pane: { kind: 'agent' } }, { id: 'report', pane: { kind: 'web', url: 'file:///work/report.html' } }] }]
  assert.equal(manualReportForNode(local, 'f', 'report', 'leaf-a')?.nodeId, 'report')
  assert.equal(manualReportForNode(local, 'f', 'report', 'leaf-b'), undefined)
  assert.equal(manualReportForNode(local, 'f', 'agent', 'leaf-a'), undefined)
})
