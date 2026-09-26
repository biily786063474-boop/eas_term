import test from 'node:test'
import assert from 'node:assert/strict'
import { reportFilePathFromUrl } from './reportFileUrl.ts'

test('report file URL decoding preserves native platform paths and encoded characters', () => {
  const url = process.platform === 'win32'
    ? 'file:///C:/Work/%E4%B8%AD%20%E6%96%87/report%20%23%3F.html'
    : 'file:///work/%E4%B8%AD%20%E6%96%87/report%20%23%3F.html'
  assert.equal(reportFilePathFromUrl(url), process.platform === 'win32'
    ? 'C:\\Work\\中 文\\report #?.html'
    : '/work/中 文/report #?.html')
  assert.equal(reportFilePathFromUrl('https://example.com/report.html'), null)
  assert.equal(reportFilePathFromUrl('file:///work/report.txt'), null)
  assert.equal(reportFilePathFromUrl('file:///work/report.html#fragment'), null)
})
