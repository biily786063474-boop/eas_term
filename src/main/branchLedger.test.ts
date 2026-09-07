// 台账的 fs 层：真写临时目录。**重点钉「记录段不丢」** —— upsert 是读→改→写，
// 要是它只顾重算头部把记录段一并覆盖掉，角色写进去的交接就没了。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import type { BoardRow } from '../shared/board.ts'
import { appendNote, readLedgers, upsertLedgers } from './branchLedger.ts'

function row(root: string, branch: string, extra: Partial<BoardRow> = {}): BoardRow {
  return {
    branch,
    roleName: '实现者',
    roleId: 'builder',
    alive: true,
    idleMs: 60_000,
    startedAt: Date.UTC(2026, 8, 6, 4, 0),
    files: ['src/a.ts'],
    cwd: path.join(root, '.worktrees', 'builder-1'),
    ...extra
  }
}

test('upsert → appendNote → upsert 往返：头部重算，记录段一条不丢', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  const rel = '.eas/board/feat--x.md'
  const abs = path.join(root, rel)

  await upsertLedgers(root, [row(root, 'feat/x')])
  const first = fs.readFileSync(abs, 'utf8')
  assert.match(first, /^# 台账 · feat\/x\n/)
  assert.match(first, /- worktree：\.worktrees\/builder-1\n/)
  assert.match(first, /- 触及：src\/a\.ts（1 文件）\n/)
  assert.ok(first.endsWith('## 记录\n'), '初稿记录段为空')

  const r = await appendNote(root, 'feat/x', '决定：先改 a.ts\n给合并官：注意 b.ts', '实现者')
  assert.deepEqual(r, { ok: true, rel })

  // 第二次 upsert 换了触及文件与状态：头部要变，记录段要原样留下
  await upsertLedgers(root, [row(root, 'feat/x', { alive: false, files: ['src/a.ts', 'src/b.ts'] })])
  const after = fs.readFileSync(abs, 'utf8')
  assert.match(after, /- 状态：已停\n/)
  assert.match(after, /- 触及：src\/a\.ts, src\/b\.ts（2 文件）\n/)
  assert.match(after, /## 记录\n- \d\d:\d\d \[实现者\] 决定：先改 a\.ts\n  给合并官：注意 b\.ts\n$/)
  assert.equal(after.split('## 记录').length, 2, '记录段标题只有一个')

  const ledgers = readLedgers(root, ['feat/x', 'no/such'])
  assert.deepEqual(Object.keys(ledgers), ['feat/x'])
  assert.equal(ledgers['feat/x'], after)
})

test('主工作区那行不造台账；rows 为空什么都不写', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  await upsertLedgers(root, [])
  await upsertLedgers(root, [row(root, '主工作区（main）', { cwd: root })])
  assert.equal(fs.existsSync(path.join(root, '.eas')), false)
})

test('appendNote：空 note 与坏分支名都拒收，不落文件', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  const empty = await appendNote(root, 'feat/x', '   \n', '实现者')
  assert.equal(empty.ok, false)
  const bad = await appendNote(root, '../x', 'hi', '实现者')
  assert.equal(bad.ok, false)
  assert.equal(fs.existsSync(path.join(root, '.eas')), false)
})

test('同一项目并发 upsert 与 append 排成一条链：谁都不把对方写丢', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  await Promise.all([
    upsertLedgers(root, [row(root, 'feat/y')]),
    appendNote(root, 'feat/y', '第一条', '实现者'),
    upsertLedgers(root, [row(root, 'feat/y', { files: [] })]),
    appendNote(root, 'feat/y', '第二条', '实现者')
  ])
  const text = fs.readFileSync(path.join(root, '.eas/board/feat--y.md'), 'utf8')
  assert.match(text, /- 触及：（无）\n/)
  assert.match(text, /\[实现者\] 第一条\n/)
  assert.match(text, /\[实现者\] 第二条\n/)
})
