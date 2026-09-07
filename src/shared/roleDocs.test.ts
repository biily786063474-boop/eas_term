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

test('roleDocsPrompt：有台账两行，没有一行；都是指针不是全文；路径是从 root 起的绝对路径', () => {
  const p = roleDocsPrompt({ root: '/p', charterRel: 'docs/roles/builder.md', ledgerRel: '.eas/board/eas--builder--ab12ef.md' })
  assert.ok(p.startsWith('## 你的角色文档\n'))
  assert.match(p, /章程：`\/p\/docs\/roles\/builder\.md`.*动手前先读/)
  assert.match(p, /台账：`\/p\/\.eas\/board\/eas--builder--ab12ef\.md`.*board_note/)
  assert.ok(!p.includes('`docs/roles/builder.md`'), '不能再给相对路径 —— 角色的 cwd 在 worktree 里，相对路径打不开')
  assert.ok(!p.includes('绑定层'), '不给模型看内部黑话')
  assert.match(p, /项目对你的要求；里面列的硬约束只是说明，执行在系统这边/)
  const q = roleDocsPrompt({ root: '/p', charterRel: 'docs/roles/scout.md', ledgerRel: null })
  assert.ok(!q.includes('台账'))
  assert.ok(q.split('\n').length <= 4)
})

test('roleDocsPrompt：root 带尾斜杠不会拼出双斜杠', () => {
  const p = roleDocsPrompt({ root: '/p/', charterRel: 'docs/roles/x.md', ledgerRel: null })
  assert.ok(p.includes('`/p/docs/roles/x.md`'))
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

test('ledgerRel：中文分支名保留字母数字（\\p{L}\\p{N}），不同角色不塌成同一个文件', () => {
  const a = ledgerRel('eas/工匠/ab12ef')
  const b = ledgerRel('eas/侦察/ab12ef')
  assert.equal(a, '.eas/board/eas--工匠--ab12ef.md')
  assert.equal(b, '.eas/board/eas--侦察--ab12ef.md')
  assert.notEqual(a, b)
})

test('renderCharter：hardNote 落在硬约束标题与列表之间；不传就没有这一行', () => {
  const note = '（按首次起会话的 Codex 算；换别家 CLI 时落法可能不同，以角色卡为准）'
  const t = renderCharter({ roleId: 'x', roleName: 'X', contract: '', hardLines: ['不许生图 · Codex：skills.config 摘掉 imagegen（硬）'], hardNote: note })
  assert.ok(t.includes(`### 硬约束（绑定层执行，改角色卡才会变）\n${note}\n- 不许生图 · Codex：skills.config 摘掉 imagegen（硬）\n`))
  const u = renderCharter({ roleId: 'x', roleName: 'X', contract: '', hardLines: ['a'] })
  assert.ok(u.includes('### 硬约束（绑定层执行，改角色卡才会变）\n- a\n'))
  assert.ok(!u.includes('以角色卡为准'))
})

test('renderCharter：硬约束为空时说明白「写在这里不算数」', () => {
  const t = renderCharter({ roleId: 'x', roleName: 'X', contract: '', hardLines: [] })
  assert.ok(t.includes('- 无（角色卡没点亮任何能力开关；要加硬限制去角色卡改，写在这里不算数）'))
})

test('renderCharter：完成判据抽取 —— 剥列表符与「完成判据：」前缀；连接符结尾的行并入下一行', () => {
  const t = renderCharter({
    roleId: 'b', roleName: 'B',
    contract: [
      '你是工匠。',
      '- 完成判据：测试全绿。',
      '算做完的条件是 ——',
      '构建通过且没有 lint 报错。',
      '别的话。'
    ].join('\n'),
    hardLines: []
  })
  const judge = t.slice(t.indexOf('## 完成判据'), t.indexOf('## 交接格式'))
  assert.ok(judge.includes('\n- 测试全绿。\n'), judge)
  assert.ok(judge.includes('\n- 算做完的条件是 ——构建通过且没有 lint 报错。\n'), judge)
  assert.ok(!judge.includes('别的话'))
  assert.ok(!judge.includes('- - '), '列表符不能叠两层')
})

test('renderCharter：完成判据行的前一行以连接符结尾时，把它并进来', () => {
  const t = renderCharter({
    roleId: 'b', roleName: 'B',
    contract: '交付前要做到，\n完成判据是全绿。',
    hardLines: []
  })
  const judge = t.slice(t.indexOf('## 完成判据'), t.indexOf('## 交接格式'))
  assert.ok(judge.includes('\n- 交付前要做到，完成判据是全绿。\n'), judge)
})

test('splitLedger：found 标志；认 CRLF 与标题尾空白；认文件开头', () => {
  assert.deepEqual(splitLedger('没有记录段的文本'), { notes: '', found: false })
  assert.deepEqual(splitLedger(''), { notes: '', found: false })
  assert.deepEqual(splitLedger('## 记录\n- a\n'), { notes: '- a\n', found: true })
  assert.deepEqual(splitLedger('# 头\r\n- x\r\n\r\n## 记录 \r\n- a\r\n- b\r\n'), { notes: '- a\r\n- b\r\n', found: true })
  assert.deepEqual(splitLedger('# 头\n## 记录\t\n'), { notes: '', found: true })
  assert.equal(splitLedger('# 头\n## 记录x\n- a\n').found, false, '「## 记录x」不是记录段标题')
})

test('renderLedger ↔ splitLedger 往返无损：note 里有「## 记录」「# 标题」与空行也不串', () => {
  const notes = '- 10:00 [工匠] 决定：\n  ## 记录\n  # 标题\n\n- 10:01 [工匠] 第二条\n## 记录\n# 标题\n\n'
  const now = Date.UTC(2026, 8, 6, 6, 31)
  const t = renderLedger(H, notes, now)
  const s = splitLedger(t)
  assert.equal(s.found, true)
  assert.equal(s.notes, notes)
  assert.equal(renderLedger(H, s.notes, now), t)
})

test('branchFromGitFiles：gitdir 相对路径按 cwd 拼；盘符路径 + CRLF', () => {
  const files: Record<string, string> = {
    '/m/sub/.git': 'gitdir: ../.git/modules/sub\n',
    '/m/sub/../.git/modules/sub/HEAD': 'ref: refs/heads/feat/sub\n',
    'C:/w/.worktrees/a/.git': 'gitdir: C:/w/.git/worktrees/a\r\n',
    'C:/w/.git/worktrees/a/HEAD': 'ref: refs/heads/feat/win\r\n'
  }
  const read = (p: string): string | null => files[p] ?? null
  assert.equal(branchFromGitFiles('/m/sub', read), 'feat/sub')
  assert.equal(branchFromGitFiles('C:/w/.worktrees/a', read), 'feat/win')
})
