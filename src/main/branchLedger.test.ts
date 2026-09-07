// 台账的 fs 层：真写临时目录。**重点钉「记录段不丢」** —— upsert 是读→改→写，
// 要是它只顾重算头部把记录段一并覆盖掉，角色写进去的交接就没了。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import type { BoardRow } from '../shared/board.ts'
import { appendNote, ledgerFiles, ledgerIdle, readLedgers, upsertLedgers } from './branchLedger.ts'

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

test('分支名 ? / HEAD（git 失败、detached）不造台账、不追加、不读', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  await upsertLedgers(root, [row(root, '?'), row(root, 'HEAD')])
  assert.equal(fs.existsSync(path.join(root, '.eas')), false)
  const r = await appendNote(root, '?', 'hi', '实现者')
  assert.equal(r.ok, false)
  assert.deepEqual(readLedgers(root, ['?', 'HEAD']), {})
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

test('同一项目并发 upsert 与 append 排成一条链：谁都不把对方写丢；ledgerIdle 等到链空', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  const all = Promise.all([
    upsertLedgers(root, [row(root, 'feat/y')]),
    appendNote(root, 'feat/y', '第一条', '实现者'),
    upsertLedgers(root, [row(root, 'feat/y', { files: [] })]),
    appendNote(root, 'feat/y', '第二条', '实现者')
  ])
  // 不 await all，直接等链空：读到的必须已经是四步全落完的样子
  await ledgerIdle(root)
  const text = fs.readFileSync(path.join(root, '.eas/board/feat--y.md'), 'utf8')
  assert.match(text, /- 触及：（无）\n/)
  assert.match(text, /\[实现者\] 第一条\n/)
  assert.match(text, /\[实现者\] 第二条\n/)
  await all
  await ledgerIdle(root) // 链空时也能 await，不挂
})

test('readLedgers 走 clipTail：超过 maxLines 只留尾部并标明前面还有几行', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  await upsertLedgers(root, [row(root, 'feat/z')])
  for (let i = 1; i <= 12; i++) await appendNote(root, 'feat/z', `第 ${i} 条`, '实现者')
  const full = fs.readFileSync(path.join(root, '.eas/board/feat--z.md'), 'utf8')
  const clipped = readLedgers(root, ['feat/z'], 5)['feat/z'] ?? ''
  assert.notEqual(clipped, full)
  assert.match(clipped, /^…（前面还有 \d+ 行）\n/)
  assert.equal(clipped.split('\n').filter(Boolean).length, 6, '一行提示 + 5 行尾部')
  assert.ok(clipped.endsWith('第 12 条\n'))
  assert.ok(!clipped.includes('第 1 条\n'))
  // 不超时原样返回
  assert.equal(readLedgers(root, ['feat/z'], 1000)['feat/z'], full)
})

test('readLedgers 扫目录：板上已经没有的分支（会话回收了）台账照样读得到，key 是首行的分支名', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  await upsertLedgers(root, [row(root, 'eas/工匠/ab12'), row(root, 'feat/gone')])
  await appendNote(root, 'feat/gone', '走之前留的话', '实现者')
  // 现在板上只剩一条；另一条的会话已经没了
  const got = readLedgers(root, ['eas/工匠/ab12'])
  assert.deepEqual(Object.keys(got).sort(), ['eas/工匠/ab12', 'feat/gone'])
  assert.match(got['feat/gone'] ?? '', /走之前留的话/)
  assert.deepEqual([...ledgerFiles(root).keys()].sort(), ['eas/工匠/ab12', 'feat/gone'])
  // 半截的临时文件与首行不是台账标题的文件都不算
  fs.writeFileSync(path.join(root, '.eas/board/feat--gone.md.999.tmp'), '# 台账 · junk\n')
  fs.writeFileSync(path.join(root, '.eas/board/notes.md'), '随手记\n')
  assert.deepEqual([...ledgerFiles(root).keys()].sort(), ['eas/工匠/ab12', 'feat/gone'])
})

test('旧文没有「## 记录」标题（found=false）：upsert 把整份旧文接回记录段，不丢字', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  const abs = path.join(root, '.eas/board/feat--old.md')
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, '手改的旧台账\n- 一条别人写的\n')
  await upsertLedgers(root, [row(root, 'feat/old')])
  const text = fs.readFileSync(abs, 'utf8')
  assert.match(text, /^# 台账 · feat\/old\n/)
  assert.ok(text.endsWith('## 记录\n手改的旧台账\n- 一条别人写的\n'), text)
  // 再追加一条，仍然只有一个记录段标题
  await appendNote(root, 'feat/old', '新的', '实现者')
  const again = fs.readFileSync(abs, 'utf8')
  assert.equal(again.split('## 记录').length, 2)
  assert.match(again, /- 一条别人写的\n- \d\d:\d\d \[实现者\] 新的\n$/)
})

// 用户点「停止」→ 会话从会话表**删掉**（不是 alive=false 留着）→ 板上没了这条分支 →
// 只 upsert rows 的话它的台账头部永远停在「活跃」。2026-09-07 真机撞到。
test('会话被移除后（rows 里没有它）：台账头部标「已停」，其余头部行与记录段一字不动', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  const absB = path.join(root, '.eas/board/feat--b.md')
  await upsertLedgers(root, [row(root, 'feat/a'), row(root, 'feat/b', { cwd: path.join(root, '.worktrees', 'b') })])
  await appendNote(root, 'feat/b', '决定：走之前留的', '实现者')
  const before = fs.readFileSync(absB, 'utf8')
  assert.match(before, /\n- 状态：活跃\n/)

  // feat/b 的会话没了：板上只剩 feat/a
  await upsertLedgers(root, [row(root, 'feat/a')])
  const after = fs.readFileSync(absB, 'utf8')
  assert.equal(after, before.replace('\n- 状态：活跃\n', '\n- 状态：已停\n'), '只有状态那一行变了')
  assert.match(after, /- worktree：\.worktrees\/b\n/)
  assert.match(after, /\[实现者\] 决定：走之前留的\n$/)
  // 还在板上的那条不受影响
  assert.match(fs.readFileSync(path.join(root, '.eas/board/feat--a.md'), 'utf8'), /\n- 状态：活跃\n/)
})

test('已经是「已停」的台账不重写：内容与 mtime 都不变', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
  const absB = path.join(root, '.eas/board/feat--b.md')
  await upsertLedgers(root, [row(root, 'feat/b')])
  await upsertLedgers(root, []) // 第一次：标已停
  const text = fs.readFileSync(absB, 'utf8')
  assert.match(text, /\n- 状态：已停\n/)
  const old = new Date(Date.now() - 60_000)
  fs.utimesSync(absB, old, old)
  const mtime = fs.statSync(absB).mtimeMs
  await upsertLedgers(root, []) // 第二次：什么都不该动
  await upsertLedgers(root, [row(root, 'feat/a')])
  assert.equal(fs.readFileSync(absB, 'utf8'), text)
  assert.equal(fs.statSync(absB).mtimeMs, mtime)
})
