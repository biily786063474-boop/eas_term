import test from 'node:test'
import assert from 'node:assert/strict'
import { reportNavigationAllowed } from './reportPreviewPolicy.ts'

test('report preview stays on the one explicitly authorized local file', () => {
  const source = 'file:///project/report.html'
  assert.equal(reportNavigationAllowed(source, source), true)
  assert.equal(reportNavigationAllowed(source + '#section', source), true)
  assert.equal(reportNavigationAllowed('file:///project/other.html', source), false)
  assert.equal(reportNavigationAllowed('https://example.com', source), false)
})
