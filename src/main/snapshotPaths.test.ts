import { test } from 'node:test'
import assert from 'node:assert'
import path from 'path'
import { snapshotTarget } from './snapshotPaths.ts'

const PROJ = '/Users/me/Projects/demo'
const D = new Date(2026, 7, 13, 9, 5, 3) // 2026-08-13 09:05:03（月份从 0 起）

test('目录是 <项目>/screenshot/<YYYY-MM-DD>', () => {
  const r = snapshotTarget(PROJ, D, [])
  assert.strictEqual(r.dir, path.join(PROJ, 'screenshot', '2026-08-13'))
})

test('文件名是 <YYYYMMDD-HHmmss>-<序号>.png，序号从 1 起', () => {
  const r = snapshotTarget(PROJ, D, [])
  assert.strictEqual(path.basename(r.file), '20260813-090503-1.png')
})

test('当天已有 2 张 → 序号是 3', () => {
  const r = snapshotTarget(PROJ, D, ['20260813-080000-1.png', '20260813-081000-2.png'])
  assert.strictEqual(path.basename(r.file), '20260813-090503-3.png')
})

test('只数 .png，别的文件不算进序号', () => {
  const r = snapshotTarget(PROJ, D, ['note.txt', '.DS_Store', '20260813-080000-1.png'])
  assert.strictEqual(path.basename(r.file), '20260813-090503-2.png')
})

test('个位数的月/日/时/分/秒都补零', () => {
  const r = snapshotTarget(PROJ, new Date(2026, 0, 2, 3, 4, 5), [])
  assert.strictEqual(r.dir, path.join(PROJ, 'screenshot', '2026-01-02'))
  assert.strictEqual(path.basename(r.file), '20260102-030405-1.png')
})

test('file 落在 dir 里面', () => {
  const r = snapshotTarget(PROJ, D, [])
  assert.strictEqual(path.dirname(r.file), r.dir)
})

test('序号有缺口（用户手动删除了第 2 张） → 取最大值 + 1', () => {
  const r = snapshotTarget(PROJ, D, ['20260813-080000-1.png', '20260813-081000-3.png'])
  assert.strictEqual(path.basename(r.file), '20260813-090503-4.png')
})

test('解析不出序号的 .png（如用户自己拖进来的 图1.png）不参与序号计算', () => {
  const r = snapshotTarget(PROJ, D, ['20260813-080000-1.png', '图1.png', '20260813-081500-2.png'])
  assert.strictEqual(path.basename(r.file), '20260813-090503-3.png')
})
