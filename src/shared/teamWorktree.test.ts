import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worktreePath, worktreeBranch, shortBatch, isolationOf, worktreeHint, belongsToProject, WORKTREE_DIR } from './teamWorktree.ts'

test('默认不隔离 —— 隔离有代价，不说就是不写码', () => {
  assert.equal(isolationOf(undefined), 'none')
  assert.equal(isolationOf('none'), 'none')
  assert.equal(isolationOf('worktree'), 'worktree')
  assert.equal(isolationOf('WORKTREE'), 'none', '只认严格小写，不猜')
  assert.equal(isolationOf('git'), 'none', '不认识的值一律当 none')
})

test('路径与分支能对上，且带得出批次与角色', () => {
  const p = worktreePath('b-1787205958035', 'backend-dev')
  const b = worktreeBranch('b-1787205958035', 'backend-dev')
  assert.equal(p, `${WORKTREE_DIR}/958035-backend-dev`)
  assert.equal(b, 'eas-team/958035-backend-dev')
})

test('同一批里不同角色不会撞路径', () => {
  const a = worktreePath('b-1', 'dev-a')
  const c = worktreePath('b-1', 'dev-b')
  assert.notEqual(a, c)
})

test('不同批次的同名角色也不会撞', () => {
  assert.notEqual(worktreePath('b-1787205958035', 'dev'), worktreePath('b-1787205111111', 'dev'))
})

test('role 不合法一律拒绝 —— 它要变成文件路径', () => {
  for (const bad of ['../x', 'a/b', 'A', 'a b', '', '中文', 'a.b']) {
    assert.equal(worktreePath('b-1', bad), null, `${JSON.stringify(bad)} 该被拒`)
    assert.equal(worktreeBranch('b-1', bad), null)
  }
})

test('批次 id 缺数字时不至于产出空路径', () => {
  assert.equal(shortBatch('b-'), '000000')
  assert.ok(worktreePath('b-', 'dev')?.includes('000000'))
})

test('收活提示必须说清「改动不在主工作区」', () => {
  // 不说的话主 agent 会去主工作区找，找不到就以为它什么都没做
  const h = worktreeHint('dev', '.worktrees/958035-dev', 'eas-team/958035-dev')
  assert.match(h, /不在主工作区/)
  assert.match(h, /git diff|git -C/, '要给出看 diff 的命令')
  assert.match(h, /语义冲突|合并前/, '要提醒 worktree 挡不住语义冲突')
})

// ── 隔离的 agent 也得算「这个项目的」 ─────────────────────────────

test('工作树里的会话属于这个项目', () => {
  // 不认的话 team_status / team_send / team_dissolve 全看不见它，
  // 那就是一个没人管得着、还在烧钱的进程
  const proj = '/W/proj'
  assert.equal(belongsToProject(proj, proj), true)
  assert.equal(belongsToProject(`${proj}/${WORKTREE_DIR}/958035-dev`, proj), true)
})

test('别的项目、以及项目内的普通子目录都不算', () => {
  const proj = '/W/proj'
  assert.equal(belongsToProject('/W/other', proj), false)
  assert.equal(belongsToProject(`${proj}/src`, proj), false, '用户另开的对话不属于这一批')
  assert.equal(belongsToProject(`${proj}-2/${WORKTREE_DIR}/x`, proj), false, '前缀相同的另一个项目')
  assert.equal(belongsToProject('', proj), false)
  assert.equal(belongsToProject(proj, ''), false)
})

test('Windows 的反斜杠路径也算这个项目（S-14）', () => {
  // git 在 Windows 上报的工作树路径是反斜杠。只判 `/` 的话这里恒假，
  // 于是所有 team_* 工具和面板在 Windows 上都看不见隔离 agent。
  assert.equal(belongsToProject('C:\\proj\\.worktrees\\b1-writer', 'C:\\proj'), true)
  assert.equal(belongsToProject('C:\\other\\.worktrees\\b1-writer', 'C:\\proj'), false)
})
