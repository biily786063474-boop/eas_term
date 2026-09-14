import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHistoryListCache } from './historyListCache.ts'

// 归档不再裁剪后文件会变大；历史面板每敲一个字都整份重读所有文件不可接受。
// 缓存按「文件 + mtime + size」记摘要与小写正文，没变的文件不再解析。
function seed(dir: string, name: string, cwd: string, texts: string[]) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ v: 2, cwd, savedAt: 1, turns: texts.map((t, i) => ({ role: i % 2 ? 'assistant' : 'user', text: t, execs: [] })) }))
}
test('未变化的文件不重复解析；改动后重新解析；搜索与项目过滤照旧', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hlc-'))
 try {
  seed(dir, 'a.json', '/p', ['你好 world', '答']); seed(dir, 'b.json', '/q', ['别的项目'])
  let parses = 0
  const cache = createHistoryListCache({ parse: file => { parses++; return JSON.parse(fs.readFileSync(file, 'utf8')) } })
  assert.deepEqual(cache.list(dir, '/p', '').map(s => s.leafId), ['a']); assert.equal(parses, 2)
  assert.deepEqual(cache.list(dir, '/p', 'WORLD').map(s => s.leafId), ['a']); assert.equal(parses, 2, '内容没变不重读')
  assert.deepEqual(cache.list(dir, '/p', '不存在'), [])
  const later = new Date(Date.now() + 5000)
  seed(dir, 'a.json', '/p', ['改了']); fs.utimesSync(path.join(dir, 'a.json'), later, later)
  assert.deepEqual(cache.list(dir, '/p', '改').map(s => s.leafId), ['a']); assert.equal(parses, 3, '变了才重读')
  fs.rmSync(path.join(dir, 'b.json'))
  assert.deepEqual(cache.list(dir, '/q', ''), [], '删掉的文件不再出现')
 } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
