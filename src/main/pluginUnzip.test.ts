import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractZip } from './pluginUnzip.ts'

// 用系统 zip 现造测试包（同 pack-plugin.mjs 的打包方式）。没有 zip 就跳过（CI 兜底）。
let hasZip = true
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' })
} catch {
  hasZip = false
}

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}
/** 在 src 目录里放好文件后打成 zip（成员名以 src 为根，同 board 包结构）。 */
function zipDir(src: string): Buffer {
  const zipPath = path.join(os.tmpdir(), `t-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
  execFileSync('zip', ['-rqX', zipPath, '.'], { cwd: src })
  const buf = fs.readFileSync(zipPath)
  fs.rmSync(zipPath, { force: true })
  return buf
}

test('正常包：根部文件与嵌套目录都解到 dest', { skip: !hasZip }, async () => {
  const src = tmp('unzip-src-')
  fs.writeFileSync(path.join(src, 'plugin.json'), '{"name":"x"}')
  fs.mkdirSync(path.join(src, 'ui'))
  fs.writeFileSync(path.join(src, 'ui', 'panel.html'), '<h1>hi</h1>')
  const buf = zipDir(src)

  const dest = tmp('unzip-dest-')
  await extractZip(buf, dest)
  assert.equal(fs.readFileSync(path.join(dest, 'plugin.json'), 'utf8'), '{"name":"x"}')
  assert.equal(fs.readFileSync(path.join(dest, 'ui', 'panel.html'), 'utf8'), '<h1>hi</h1>')
})

test('条目数超限：整包拒', { skip: !hasZip }, async () => {
  const src = tmp('unzip-src-')
  fs.writeFileSync(path.join(src, 'a'), '1')
  fs.writeFileSync(path.join(src, 'b'), '2')
  fs.writeFileSync(path.join(src, 'c'), '3')
  const buf = zipDir(src)
  const dest = tmp('unzip-dest-')
  await assert.rejects(() => extractZip(buf, dest, { maxEntries: 2, maxBytes: 1 << 20 }), /文件过多/)
})

test('解压总字节超限：整包拒', { skip: !hasZip }, async () => {
  const src = tmp('unzip-src-')
  fs.writeFileSync(path.join(src, 'big'), 'x'.repeat(2048))
  const buf = zipDir(src)
  const dest = tmp('unzip-dest-')
  await assert.rejects(() => extractZip(buf, dest, { maxEntries: 10, maxBytes: 512 }), /体积超上限/)
})
