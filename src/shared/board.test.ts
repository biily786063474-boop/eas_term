import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOARD_REL, clipForPrompt, findOverlaps, renderBoard, type BoardRow } from './board.ts'

const row = (p: Partial<BoardRow>): BoardRow => ({
  branch: 'eas/builder/ab12ef', roleName: '工匠', roleId: 'builder', alive: true, idleMs: 0,
  startedAt: Date.UTC(2026, 8, 5, 5, 10), files: [], cwd: '/p/.worktrees/builder-ab12ef', ...p
})

test('BOARD_REL 固定', () => assert.equal(BOARD_REL, '.eas/board.md'))

test('空板：一句「没有活跃分支」而不是空表', () => {
  const s = renderBoard([], Date.UTC(2026, 8, 5, 6))
  assert.ok(s.startsWith('# 协同板'))
  assert.ok(s.includes('勿手改'))
  assert.ok(s.includes('没有活跃分支'))
})

test('一行：分支 / 角色 / 状态（活跃 or 闲置 N 分钟）/ 起于 / 触及（≤3 个文件全列，多了按目录归并 + 计数）', () => {
  const now = Date.UTC(2026, 8, 5, 6, 0)
  const s = renderBoard([
    row({ files: ['src/a.ts', 'src/b.ts'] }),
    row({ branch: 'eas/e2e/9c0d11', roleName: '全流程', alive: true, idleMs: 40 * 60_000, startedAt: Date.UTC(2026, 8, 5, 3, 2),
      files: ['src/renderer/src/features/agentChat/x.tsx', 'src/renderer/src/features/agentChat/y.tsx', 'src/renderer/src/features/agentChat/z.tsx', 'src/renderer/src/features/agentChat/w.tsx'] })
  ], now)
  assert.ok(s.includes('| eas/builder/ab12ef | 工匠 | 活跃 |'))
  assert.ok(s.includes('src/a.ts, src/b.ts'))
  assert.ok(s.includes('| eas/e2e/9c0d11 | 全流程 | 闲置 40 分钟 |'))
  assert.ok(s.includes('src/renderer/src/features/agentChat/**（4 文件）'))
})

test('进程没了但记录还在 → 状态「已停」', () => {
  const s = renderBoard([row({ alive: false, idleMs: 5 * 60_000 })], Date.UTC(2026, 8, 5, 6))
  assert.ok(s.includes('| 已停 |'))
})

// 时间列是给坐在这台机器前的人读的，所以是**本地**时间。断言用本地构造 +
// 本地 getter 回读，任何时区跑都成立（原来这里是 getUTC*，差几小时看机器在哪个时区）。
test('时间用本地时区，不是 UTC', () => {
  const started = new Date(2026, 8, 5, 13, 10).getTime()
  const now = new Date(2026, 8, 5, 14, 2).getTime()
  const d = new Date(now)
  const p = (n: number): string => String(n).padStart(2, '0')
  const s = renderBoard([row({ startedAt: started })], now)
  assert.ok(
    s.startsWith(`# 协同板 · ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} `)
  )
  assert.ok(s.includes(`| ${p(new Date(started).getHours())}:${p(new Date(started).getMinutes())} |`))
})

test('同一条分支上两个活会话改同一文件不算交集（分支先去重）', () => {
  const rows = [
    row({ cwd: '/p/.worktrees/builder-ab12ef', files: ['src/a.ts'] }),
    row({ cwd: '/p/.worktrees/builder-ab12ef', files: ['src/a.ts'] })
  ]
  assert.deepEqual(findOverlaps(rows), [])
})

test('findOverlaps：两条分支碰同一文件才算，且只报活跃的', () => {
  const rows = [
    row({ files: ['src/shared/types.ts', 'src/a.ts'] }),
    row({ branch: 'eas/e2e/9c0d11', files: ['src/shared/types.ts'] }),
    row({ branch: 'eas/scout/000000', alive: false, files: ['src/a.ts'] })
  ]
  assert.deepEqual(findOverlaps(rows), [{ file: 'src/shared/types.ts', branches: ['eas/builder/ab12ef', 'eas/e2e/9c0d11'] }])
})

test('renderBoard 把交集写成 ⚠ 行', () => {
  const rows = [row({ files: ['src/shared/types.ts'] }), row({ branch: 'eas/e2e/9c0d11', files: ['src/shared/types.ts'] })]
  const s = renderBoard(rows, Date.UTC(2026, 8, 5, 6), findOverlaps(rows))
  assert.ok(s.includes('⚠ 两条分支都改了 src/shared/types.ts（eas/builder/ab12ef, eas/e2e/9c0d11）'))
})

test('clipForPrompt：≤20 行原样；超过截到 20 行并附路径与 board_read 提示', () => {
  const short = Array.from({ length: 5 }, (_, i) => `l${i}`).join('\n')
  assert.equal(clipForPrompt(short), short)
  const long = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n')
  const c = clipForPrompt(long)
  assert.equal(c.split('\n').length, 21)
  assert.ok(c.endsWith('…（还有 10 行，完整内容见 .eas/board.md，用 board_read 读）'))
})
