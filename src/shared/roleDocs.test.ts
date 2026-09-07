import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendLedgerNote, branchFromGitFiles, charterRel, clipTail, ledgerRel,
  renderCharter, renderLedger, roleDocsPrompt, splitLedger
} from './roleDocs.ts'

test('charterRel：只认 [a-z][a-z0-9-]*', () => {
  assert.equal(charterRel('builder'), 'docs/roles/builder.md')
  assert.equal(charterRel('my-role2'), 'docs/roles/my-role2.md')
  for (const bad of ['', 'A', '../x', 'a/b', '1a']) assert.equal(charterRel(bad), null, bad)
})

test('ledgerRel：/ 变 --，其余非 [A-Za-z0-9._-] 变 -，拒绝空与 ..', () => {
  assert.equal(ledgerRel('eas/builder/ab12ef'), '.eas/board/eas--builder--ab12ef.md')
  assert.equal(ledgerRel('feat x'), '.eas/board/feat-x.md')
  assert.equal(ledgerRel(''), null)
  assert.equal(ledgerRel('a..b'), null)
})

test('renderCharter：顶部软约束说明、四段、边界留空、契约进产出段、硬约束逐行', () => {
  const t = renderCharter({
    roleId: 'builder', roleName: '工匠',
    contract: '你是工匠。\n完成判据：测试全绿。',
    hardLines: ['不许生图 · Codex：skills.config 摘掉 imagegen（硬）']
  })
  assert.ok(t.startsWith('# 工匠 · 本项目章程\n'))
  assert.match(t, /软约束/)
  assert.match(t, /硬约束.*绑定层/)
  for (const h of ['## 边界', '## 产出与落点', '## 完成判据', '## 交接格式（写进台账的字段）']) assert.ok(t.includes(h), h)
  assert.match(t, /- 可以改：\n- 不要碰：/)
  assert.ok(t.includes('你是工匠。'))
  assert.ok(t.includes('完成判据：测试全绿。'))
  assert.ok(t.includes('- 不许生图 · Codex：skills.config 摘掉 imagegen（硬）'))
  assert.ok(t.endsWith('\n'))
})

test('renderCharter：没有硬约束时写「无」，契约为空时写占位', () => {
  const t = renderCharter({ roleId: 'x', roleName: 'X', contract: '', hardLines: [] })
  assert.match(t, /硬约束[^\n]*\n[^\n]*无/)
  assert.match(t, /（角色卡没有契约，请补）/)
})

const H = { branch: 'eas/builder/ab12ef', roleName: '工匠', worktree: '.worktrees/builder-ab12ef', startedAt: Date.UTC(2026, 8, 6, 6, 2), lastActiveAt: Date.UTC(2026, 8, 6, 6, 31), alive: true, files: ['src/a.ts', 'src/b.ts'] }

test('renderLedger：头部字段齐全，记录段原样保留', () => {
  const t = renderLedger(H, '- 14:05 [工匠] 决定：用 A 方案\n', Date.UTC(2026, 8, 6, 6, 31))
  assert.ok(t.startsWith('# 台账 · eas/builder/ab12ef\n'))
  assert.match(t, /头部由 app 维护/)
  assert.match(t, /- 角色：工匠/)
  assert.match(t, /- worktree：\.worktrees\/builder-ab12ef/)
  assert.match(t, /- 状态：活跃/)
  assert.match(t, /- 触及：src\/a\.ts, src\/b\.ts（2 文件）/)
  assert.ok(t.endsWith('## 记录\n- 14:05 [工匠] 决定：用 A 方案\n'))
})

test('renderLedger：已停 / 无 worktree / 无触及', () => {
  const t = renderLedger({ ...H, alive: false, worktree: null, files: [] }, '', 0)
  assert.match(t, /- 状态：已停/)
  assert.match(t, /- worktree：（无）/)
  assert.match(t, /- 触及：（无）/)
  assert.ok(t.endsWith('## 记录\n'))
})

test('splitLedger / appendLedgerNote：只动记录段，多行 note 缩进为续行', () => {
  const t0 = renderLedger(H, '', 0)
  assert.equal(splitLedger(t0).notes, '')
  const t1 = appendLedgerNote(t0, '决定：用 A 方案\n原因：B 太重', '工匠', Date.UTC(2026, 8, 6, 6, 5))
  const notes = splitLedger(t1).notes
  assert.match(notes, /^- \d\d:\d\d \[工匠\] 决定：用 A 方案\n  原因：B 太重\n$/)
  const t2 = appendLedgerNote(t1, '第二条', '工匠', 0)
  assert.equal(splitLedger(t2).notes.split('\n').filter(Boolean).length, 3)
  assert.equal(splitLedger('没有记录段的文本').notes, '')
  assert.ok(appendLedgerNote('没有记录段的文本', 'x', 'R', 0).includes('## 记录\n- '))
})

test('clipTail：不超不动，超出保留尾部并加提示行', () => {
  assert.equal(clipTail('a\nb\n', 5), 'a\nb\n')
  const c = clipTail(['1', '2', '3', '4', '5'].join('\n') + '\n', 2)
  assert.equal(c, '…（前面还有 3 行）\n4\n5\n')
})

test('roleDocsPrompt：有台账两行，没有一行；都是指针不是全文', () => {
  const p = roleDocsPrompt({ charterRel: 'docs/roles/builder.md', ledgerRel: '.eas/board/eas--builder--ab12ef.md' })
  assert.ok(p.startsWith('## 你的角色文档\n'))
  assert.match(p, /章程：`docs\/roles\/builder\.md`.*动手前先读/)
  assert.match(p, /台账：`\.eas\/board\/eas--builder--ab12ef\.md`.*board_note/)
  const q = roleDocsPrompt({ charterRel: 'docs/roles/scout.md', ledgerRel: null })
  assert.ok(!q.includes('台账'))
  assert.ok(q.split('\n').length <= 4)
})

test('branchFromGitFiles：worktree 的 .git 是文件，主工作区是目录，detached 为 null', () => {
  const files: Record<string, string> = {
    '/p/.worktrees/b-1/.git': 'gitdir: /p/.git/worktrees/b-1\n',
    '/p/.git/worktrees/b-1/HEAD': 'ref: refs/heads/eas/builder/ab12ef\n',
    '/p/.git/HEAD': 'ref: refs/heads/main\n',
    '/q/.git': 'gitdir: /q/../.git/wt\n',
    '/q/../.git/wt/HEAD': 'abcdef1234567890\n'
  }
  const read = (p: string): string | null => files[p] ?? null
  assert.equal(branchFromGitFiles('/p/.worktrees/b-1', read), 'eas/builder/ab12ef')
  assert.equal(branchFromGitFiles('/p', read), 'main')
  assert.equal(branchFromGitFiles('/q', read), null)
  assert.equal(branchFromGitFiles('/nope', read), null)
})
