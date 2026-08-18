import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseApproval } from './approvalParse.ts'

// 2026-08-18 用户报的：灵动岛上显示着一段 minified JS
// （`e.context = 2; return "keyword"; } else if`）—— 那是他终端里恰好在审批框
// 上方的源码，被当成「待执行的命令」抓上去了。
test('问句上方隔着空行的无关内容不许被当成正文', () => {
  const r = parseApproval([
    'src/parser.js',
    '  if (t === 0) { e.context = 2; return "keyword"; } else if',
    '',
    'Do you want to allow this?',
    '  1. Yes',
    '  2. No'
  ])
  assert.ok(r, '这仍然是个真审批框，不该整个认不出')
  assert.equal(r.body, '', '宁可正文为空，也不能显示上一段无关内容')
  assert.ok(!r.body.includes('e.context'), '绝不能把屏幕上的源码抓进来')
})

// 真实的框里，正文和问句之间是有留白的 —— 不能因为怕误抓就把这种情况也砍掉
test('带框的审批框能跨框内留白抓到正文', () => {
  const r = parseApproval([
    'some unrelated code line',
    '╭──────────────────────────╮',
    '│ Bash command             │',
    '│                          │',
    '│ rm -rf /tmp/build        │',
    '│                          │',
    '│ Do you want to proceed?  │',
    '│  1. Yes                  │',
    '│  2. No                   │',
    '╰──────────────────────────╯'
  ])
  assert.ok(r)
  assert.equal(r.body, 'rm -rf /tmp/build')
  assert.ok(!r.body.includes('unrelated'), '框外的行不许进来')
})

test('无边框但正文紧邻问句：照常抓得到', () => {
  const r = parseApproval(['npm run deploy', 'Do you want to proceed?', '  1. Yes', '  2. No'])
  assert.ok(r)
  assert.equal(r.body, 'npm run deploy')
})

test('少于两个选项不算审批框', () => {
  assert.equal(parseApproval(['Do you want to proceed?', '  1. Yes']), null)
})

// 跳号说明把不相干的编号列表拼在了一起
test('序号不连续 / 不从 1 开始 → 不是审批框', () => {
  assert.equal(parseApproval(['Proceed?', '  2. A', '  3. B']), null)
  assert.equal(parseApproval(['Proceed?', '  1. A', '  3. B']), null)
})

test('没有问句 → 不是审批框', () => {
  assert.equal(parseApproval(['随便一段输出', '  1. A', '  2. B']), null)
})

test('危险命令仍然认得出（正文变严格不该影响它）', () => {
  const r = parseApproval([
    '╭────────────────────────╮',
    '│ rm -rf ~/Documents     │',
    '│ Do you want to proceed?│',
    '│  1. Yes                │',
    '│  2. No                 │',
    '╰────────────────────────╯'
  ])
  assert.ok(r)
  assert.equal(r.dangerous, true)
})
