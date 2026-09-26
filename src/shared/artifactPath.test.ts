import test from 'node:test'
import assert from 'node:assert/strict'
import { safeArtifactPath, artifactFileUrl, artifactPathFromFileUrl } from './artifactPath.ts'

test('macOS artifact paths retain relative and absolute project containment', () => {
  assert.equal(safeArtifactPath('reports/a.html', '/work/app'), '/work/app/reports/a.html')
  assert.equal(safeArtifactPath('/work/app/reports/../a.html', '/work/app'), '/work/app/a.html')
  assert.throws(() => safeArtifactPath('../secret.html', '/work/app'), /路径越界/)
  assert.throws(() => safeArtifactPath('/work/application/a.html', '/work/app'), /路径越界/)
  assert.equal(safeArtifactPath('a\\b.html', '/work/app', undefined, 'darwin'), '/work/app/a\\b.html')
  assert.equal(artifactFileUrl('/work/app/a\\b.html', 'darwin'), 'file:///work/app/a%5Cb.html')
})

test('Windows drive paths are absolute and case-insensitive within one project', () => {
  assert.equal(safeArtifactPath('C:\\Work\\App\\report.html', 'c:\\work\\app', undefined, 'win32'), 'C:/Work/App/report.html')
  assert.equal(safeArtifactPath('reports\\one.html', 'C:\\Work\\App', undefined, 'win32'), 'C:/Work/App/reports/one.html')
  assert.throws(() => safeArtifactPath('D:\\Work\\App\\report.html', 'C:\\Work\\App', undefined, 'win32'), /路径越界/)
  assert.throws(() => safeArtifactPath('C:\\Work\\Application\\report.html', 'C:\\Work\\App', undefined, 'win32'), /路径越界/)
  assert.throws(() => safeArtifactPath('..\\report.html', 'C:\\Work\\App', undefined, 'win32'), /路径越界/)
})

test('UNC paths stay inside their share and reject sibling or server escape', () => {
  assert.equal(safeArtifactPath('reports\\a.html', '\\\\server\\share\\project', undefined, 'win32'), '//server/share/project/reports/a.html')
  assert.throws(() => safeArtifactPath('\\\\server\\share\\other\\a.html', '\\\\server\\share\\project', undefined, 'win32'), /路径越界/)
})

test('file URLs encode special characters and round-trip local paths', () => {
  assert.equal(artifactFileUrl('/work/中 文/#?.html'), 'file:///work/%E4%B8%AD%20%E6%96%87/%23%3F.html')
  assert.equal(artifactPathFromFileUrl(artifactFileUrl('/work/中 文/#?.html')), '/work/中 文/#?.html')
  assert.equal(artifactFileUrl('C:\\Work\\中 文\\report #?.html', 'win32'), 'file:///C:/Work/%E4%B8%AD%20%E6%96%87/report%20%23%3F.html')
  assert.equal(artifactPathFromFileUrl(artifactFileUrl('C:\\Work\\中 文\\report #?.html', 'win32'), 'win32'), 'C:/Work/中 文/report #?.html')
  assert.equal(artifactFileUrl('\\\\server\\share\\report.html', 'win32'), 'file://server/share/report.html')
  assert.equal(artifactPathFromFileUrl('file://localhost/work/report.html'), '/work/report.html')
  assert.throws(() => artifactPathFromFileUrl('https://example.com/report.html'), /仅能选择/)
})
