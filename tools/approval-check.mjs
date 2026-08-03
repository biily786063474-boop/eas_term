// 审批框解析器的样本检查。项目没装测试框架，这个脚本就是它的测试：
//   node tools/approval-check.mjs
//
// 样本分两类，**反例比正例重要**——认不出只是少个便利功能，
// 认错了就是替用户按下了他没看清的确认。加新样本时优先加反例。
import { parseApproval } from '../src/renderer/src/features/terminal/approvalParse.ts'

const L = (s) => s.split('\n')

const cases = [
  {
    name: 'Claude Code · Bash 命令审批',
    input: L(`╭──────────────────────────────────────────────────────╮
│ Bash command                                         │
│                                                      │
│   npm run build                                      │
│   构建产物到 out/                                     │
│                                                      │
│ Do you want to proceed?                              │
│ ❯ 1. Yes                                             │
│   2. Yes, and don't ask again for npm commands       │
│   3. No, and tell Claude what to do differently      │
╰──────────────────────────────────────────────────────╯`),
    expect: { options: 3, dangerous: false, bodyHas: 'npm run build' }
  },
  {
    name: 'Claude Code · 危险命令（rm -rf）',
    input: L(`╭──────────────────────────────────────────────────────╮
│ Bash command                                         │
│                                                      │
│   rm -rf node_modules                                │
│                                                      │
│ Do you want to proceed?                              │
│ ❯ 1. Yes                                             │
│   2. No                                              │
╰──────────────────────────────────────────────────────╯`),
    expect: { options: 2, dangerous: true }
  },
  {
    name: 'Codex 风格 · 无边框',
    input: L(`
  Allow command?
  1. Yes
  2. Yes, don't ask again
  3. No`),
    expect: { options: 3, dangerous: false }
  },
  {
    name: '中文问句',
    input: L(`  即将写入 src/main/index.ts
  是否继续？
  1. 允许
  2. 拒绝`),
    expect: { options: 2, dangerous: false, bodyHas: 'src/main/index.ts' }
  },
  {
    name: 'sudo 出现在选项文案里也算危险',
    input: L(`  Run installer?
  1. Yes, with sudo
  2. No`),
    expect: { options: 2, dangerous: true }
  },

  {
    // 回归样本：终端内容不满一屏时，可见区下方全是空行。曾经因为
    // 「从末尾数 24 行」把框挤出扫描范围，导致同一个框时认得出时认不出。
    name: '框下方有大片空行（不满一屏的终端）',
    input: [
      ...L(`╭──────────────────────────────────────────╮
│ Bash command                             │
│                                          │
│   rm -rf node_modules                    │
│                                          │
│ Do you want to proceed?                  │
│ ❯ 1. Yes                                 │
│   2. No                                  │
╰──────────────────────────────────────────╯`),
      ...Array(28).fill('')
    ],
    expect: { options: 2, dangerous: true, bodyHas: 'rm -rf node_modules' }
  },
  {
    // 同上，外加屏幕上还残留着上一轮的框——解析必须认最后那个
    name: '屏幕上残留上一轮的框',
    input: [
      ...L(`│ Do you want to proceed?                  │
│ ❯ 1. Yes                                 │
│   2. No                                  │
╰──────────────────────────────────────────╯
SELECTED=[1]
biily@mac proj %`),
      ...L(`╭──────────────────────────────────────────╮
│ Bash command                             │
│                                          │
│   git push --force origin main           │
│                                          │
│ Do you want to proceed?                  │
│ ❯ 1. Yes                                 │
│   2. No                                  │
╰──────────────────────────────────────────╯`),
      ...Array(12).fill('')
    ],
    expect: { options: 2, dangerous: true, bodyHas: 'git push --force' }
  },

  // ---- 反例：以下都必须返回 null ----
  {
    name: '反例 · agent 输出的普通编号列表',
    input: L(`我做了这些改动：
  1. 修了 canvas.json 的原子写入
  2. 补了掉电测试
  3. 更新了文档
现在开始跑测试。`),
    expect: null
  },
  {
    name: '反例 · 只有一个选项',
    input: L(`  Do you want to proceed?
  1. Yes`),
    expect: null
  },
  {
    name: '反例 · 序号跳号（拼错了两处列表）',
    input: L(`  Do you want to proceed?
  1. Yes
  3. No`),
    expect: null
  },
  {
    name: '反例 · 有选项但没有问句',
    input: L(`  Available models:
  1. opus
  2. sonnet`),
    expect: null
  },
  {
    name: '反例 · 序号不从 1 开始',
    input: L(`  Do you want to proceed?
  2. Yes
  3. No`),
    expect: null
  },
  {
    name: '反例 · 空屏',
    input: L(`

`),
    expect: null
  },
  {
    name: '反例 · 纯 shell 提示符',
    input: L(`biily@mac ~/proj % ls
README.md  src  package.json
biily@mac ~/proj % `),
    expect: null
  }
]

let pass = 0
let fail = 0
for (const c of cases) {
  const got = parseApproval(c.input)
  const errs = []
  if (c.expect === null) {
    if (got !== null) errs.push(`应认不出，却认出了 ${JSON.stringify(got)}`)
  } else if (!got) {
    errs.push('应认出，却返回 null')
  } else {
    if (got.options.length !== c.expect.options)
      errs.push(`选项数 ${got.options.length} ≠ ${c.expect.options}`)
    if (got.dangerous !== c.expect.dangerous)
      errs.push(`dangerous ${got.dangerous} ≠ ${c.expect.dangerous}`)
    if (c.expect.bodyHas && !got.body.includes(c.expect.bodyHas))
      errs.push(`正文里没有「${c.expect.bodyHas}」，实际是「${got.body}」`)
    if (got.options[0].index !== 1) errs.push('首个选项序号不是 1')
  }
  if (errs.length) {
    fail++
    console.log(`✗ ${c.name}`)
    errs.forEach((e) => console.log(`    ${e}`))
  } else {
    pass++
    console.log(`✓ ${c.name}`)
  }
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
