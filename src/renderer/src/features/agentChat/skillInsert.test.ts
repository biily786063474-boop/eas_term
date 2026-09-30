import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skillInsertText } from './skillInsert.ts'

const base = {
  skillPath: '/h/.claude/skills/probe-dir',
  name: 'probe-skill',
  exposed: false,
  claudeDirs: ['/h/.claude/skills', '/p/.claude/skills']
}

test('Claude + 开头的 / + Claude 会加载的目录 → 原生 /名字（隐藏与否都一样）', () => {
  assert.equal(skillInsertText({ ...base, cli: 'claude', mode: '/' }), '/probe-skill')
  assert.equal(skillInsertText({ ...base, cli: 'claude', mode: '/', exposed: true }), '/probe-skill')
  assert.equal(skillInsertText({ ...base, cli: 'claude', mode: '/', skillPath: '/p/.claude/skills/x/' , name: 'x' }), '/x')
})

test('frontmatter 名当不了命令时退回目录名', () => {
  assert.equal(skillInsertText({ ...base, cli: 'claude', mode: '/', name: '我的 技能' }), '/probe-dir')
})

test('隐藏 + 走不了原生命令 → 只让它读文件，不出现「使用技能」', () => {
  const md = '按照 /h/.claude/skills/probe-dir/SKILL.md 中的说明执行'
  assert.equal(skillInsertText({ ...base, cli: 'claude', mode: '@' }), md)
  assert.equal(skillInsertText({ ...base, cli: 'codex', mode: '/' }), md)
  // CLI 不扫的目录（design-skills 之类）用不了 /名字
  assert.equal(
    skillInsertText({ ...base, cli: 'claude', mode: '/', skillPath: '/h/.claude/design-skills/probe-dir' }),
    '按照 /h/.claude/design-skills/probe-dir/SKILL.md 中的说明执行'
  )
})

test('开着的 skill、走不了原生命令 → 保持原来的写法', () => {
  assert.equal(
    skillInsertText({ ...base, cli: 'codex', mode: '@', exposed: true }),
    '使用技能「probe-skill」（/h/.claude/skills/probe-dir/SKILL.md）'
  )
})
