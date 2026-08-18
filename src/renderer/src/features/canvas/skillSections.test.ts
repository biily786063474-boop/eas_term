import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSkillSections } from './skillSections.ts'

test('两个来源都在时，项目段排在全局段前面', () => {
  const s = planSkillSections({
    projectName: 'taptv',
    projectPath: '/p/taptv/.claude/skills',
    globalLabel: 'Claude',
    globalPath: '/home/.claude/skills'
  })
  assert.equal(s.length, 2)
  assert.equal(s[0].scope, 'project')
  assert.equal(s[0].tag, '项目')
  assert.equal(s[1].scope, 'global')
  assert.equal(s[1].tag, '全局')
})

test('没选项目时只有全局那段', () => {
  const s = planSkillSections({ globalLabel: 'Claude', globalPath: '/home/.claude/skills' })
  assert.equal(s.length, 1)
  assert.equal(s[0].scope, 'global')
})

test('选了项目但一个全局目录都没有时，只剩项目段', () => {
  const s = planSkillSections({ projectName: 'x', projectPath: '/p/x/.claude/skills' })
  assert.deepEqual(
    s.map((v) => v.scope),
    ['project']
  )
})

// 用户可以把任意目录加成自定义全局目录，包括某个项目自己的 .claude/skills。
// 撞车时留项目那段——不去重的话同一批 skill 会上下各显示一次。
test('两段指向同一个目录时只保留项目段', () => {
  const s = planSkillSections({
    projectName: 'x',
    projectPath: '/p/x/.claude/skills',
    globalLabel: '手动加的',
    globalPath: '/p/x/.claude/skills/'
  })
  assert.equal(s.length, 1)
  assert.equal(s[0].scope, 'project')
})

test('项目没名字时段头有兜底文案，不显示成空白', () => {
  const s = planSkillSections({ projectName: '  ', projectPath: '/p/x/.claude/skills' })
  assert.equal(s[0].label, '这个项目')
})

test('空字符串路径当作没有这一段', () => {
  assert.deepEqual(planSkillSections({ projectPath: '   ', globalPath: '' }), [])
})
