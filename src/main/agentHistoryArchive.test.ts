import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { saveArchive, loadArchiveWindow } from './agentHistoryArchive.ts'

// 主进程侧：保存 = 读旧档 → 按序号并集 → 原子写；读取 = 只回最近 n 条（磁盘保留全部）。
const T = (seq: number, text: string) => ({ role: 'assistant' as const, text, execs: [], seq })

test('两次保存只带窗口，磁盘保留全部；读取只回窗口', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-')), file = path.join(dir, 'k.json')
 try {
  assert.equal(saveArchive(file, { cwd: '/p', resumeId: null, resumeCli: null, moduleId: null }, [T(1, '一'), T(2, '二'), T(3, '三')]), true)
  assert.equal(saveArchive(file, { cwd: '/p', resumeId: 'r', resumeCli: 'claude', moduleId: null }, [T(3, '三改'), T(4, '四')]), true)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(raw.turns.map((t: { text: string }) => t.text), ['一', '二', '三改', '四'])
  assert.equal(raw.resumeId, 'r'); assert.equal(raw.cwd, '/p')
  const win = loadArchiveWindow(file, 2)
  assert.deepEqual(win.turns.map(t => (t as { text: string }).text), ['三改', '四']); assert.equal(win.total, 4); assert.equal(win.resumeId, 'r')
 } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('旧档（无序号）读出来带上补的序号，再保存时不会被新窗口覆盖掉', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-')), file = path.join(dir, 'k.json')
 try {
  fs.writeFileSync(file, JSON.stringify({ v: 1, cwd: '/p', turns: [{ role: 'user', text: '旧问', execs: [] }, { role: 'assistant', text: '旧答', execs: [] }] }))
  const win = loadArchiveWindow(file, 100)
  assert.deepEqual(win.turns.map(t => (t as { seq: number }).seq), [0, 1])
  saveArchive(file, { cwd: '/p', resumeId: null, resumeCli: null, moduleId: null }, [T(Date.now(), '新答')])
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(raw.turns.map((t: { text: string }) => t.text), ['旧问', '旧答', '新答'])
 } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('空窗口不写盘、不删旧档', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-')), file = path.join(dir, 'k.json')
 try {
  saveArchive(file, { cwd: '/p', resumeId: null, resumeCli: null, moduleId: null }, [T(1, '一')])
  assert.equal(saveArchive(file, { cwd: '/p', resumeId: null, resumeCli: null, moduleId: null }, []), false)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).turns.length, 1)
 } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
