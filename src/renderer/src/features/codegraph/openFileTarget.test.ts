import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileAbsPath, openGraphFile } from './openFileTarget.ts'

// 代码地图上点文件节点 / 文件列表 → 打开那个文件（2026-09-14 用户要求）。
// 画布里：在地图所在的同一 Frame 开一个预览节点（复用 openArtifact，同文件不重复开）；
// 分屏里：走既有 openFile。图上的 id 是相对项目根、'/' 分隔；root 是绝对路径。
test('相对 id 拼到项目根；root 带尾斜杠或 Windows 反斜杠都不出双分隔符', () => {
  assert.equal(fileAbsPath('/p/root', 'src/main/pty.ts'), '/p/root/src/main/pty.ts')
  assert.equal(fileAbsPath('/p/root/', 'src/main/pty.ts'), '/p/root/src/main/pty.ts')
  assert.equal(fileAbsPath('C:\\proj\\root', 'src/a.ts'), 'C:\\proj\\root\\src\\a.ts')
  assert.equal(fileAbsPath('/p/root', '/abs/already.ts'), '/abs/already.ts')
})
test('有 frameId：在该 Frame 开预览节点（代码 / 图片按扩展名）；没有：走 openFile', () => {
  const calls: unknown[] = []
  const deps = { openArtifact: (frameId: string, pane: unknown) => { calls.push(['artifact', frameId, pane]); return { nodeId: 'n', reused: false } }, openFile: (p: string) => { calls.push(['file', p]) } }
  openGraphFile('/p', 'src/x.ts', { ...deps, frameId: 'f1' })
  assert.deepEqual(calls.pop(), ['artifact', 'f1', { kind: 'code', filePath: '/p/src/x.ts' }])
  openGraphFile('/p', 'docs/a.png', { ...deps, frameId: 'f1' })
  assert.deepEqual(calls.pop(), ['artifact', 'f1', { kind: 'image', filePath: '/p/docs/a.png' }])
  openGraphFile('/p', 'src/x.ts', deps)
  assert.deepEqual(calls.pop(), ['file', '/p/src/x.ts'])
})
test('模块级节点（Swift target 这类不是文件的 id）不打开', () => {
  let n = 0
  openGraphFile('/p', 'MyTarget', { frameId: 'f', openArtifact: () => { n++; return { nodeId: '', reused: false } }, openFile: () => { n++ } })
  assert.equal(n, 0)
})
