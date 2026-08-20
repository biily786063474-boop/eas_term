import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  slashQuery,
  matchSlash,
  skillsToCmds,
  atQuery,
  applyAtPick,
  filesToCmds,
  BUILTIN_SLASH
} from './slashCommands.ts'

test('只认开头的斜杠 —— 句子中间的是路径不是命令', () => {
  assert.equal(slashQuery('/co'), 'co')
  assert.equal(slashQuery('/'), '')
  assert.equal(slashQuery('看下 src/main/x.ts'), null)
  assert.equal(slashQuery('2026/08/20'), null)
})

test('有空格就不再是在选命令了（已经在填参数）', () => {
  assert.equal(slashQuery('/model opus'), null)
  assert.equal(slashQuery('/compact '), null)
})

test('前缀匹配排在包含匹配前面', () => {
  const all = [
    { name: 'context', desc: '', from: 'builtin' as const },
    { name: 'my-co-skill', desc: '', from: 'skill' as const },
    { name: 'compact', desc: '', from: 'builtin' as const }
  ]
  const got = matchSlash('co', all).map((c) => c.name)
  assert.deepEqual(got.slice(0, 2).sort(), ['compact', 'context'])
  assert.equal(got[2], 'my-co-skill')
})

test('同档内内置优先 —— 几十个 skill 不该把那几条内置挤出视野', () => {
  const all = [
    { name: 'cost-report', desc: '', from: 'skill' as const },
    { name: 'cost', desc: '', from: 'builtin' as const }
  ]
  assert.equal(matchSlash('cost', all)[0].name, 'cost')
})

test('空 query 给全部', () => {
  assert.equal(matchSlash('', BUILTIN_SLASH).length, BUILTIN_SLASH.length)
})

test('实测不可用的命令不在内置表里', () => {
  // 列一个点了只会回「isn't available in this environment」的，比不列更糟
  for (const bad of ['help', 'status', 'memory', 'rewind']) {
    assert.ok(!BUILTIN_SLASH.some((c) => c.name === bad), `${bad} 不该在候选里`)
  }
})

test('命令名取目录名，不是 frontmatter 的 name', () => {
  // frontmatter 的 name 是给人看的标题（中文、带空格），当不了命令
  const got = skillsToCmds([{ path: '/Users/x/.claude/skills/design-router', name: '设计路由' }])
  assert.deepEqual(got.map((x) => x.name), ['design-router'])
})

test('去重、跳过非法目录名、末尾斜杠不影响', () => {
  const got = skillsToCmds([
    { path: '/s/a' },
    { path: '/other/a' },
    { path: '/s/b c' },
    { path: '/s/d/' },
    { path: '' }
  ])
  assert.deepEqual(got.map((x) => x.name), ['a', 'd'])
})

test('被禁用的 skill 不进候选', () => {
  const got = skillsToCmds([{ path: '/s/on' }, { path: '/s/off' }], ['/s/off'])
  assert.deepEqual(got.map((x) => x.name), ['on'])
})

test('描述太长要截断，没描述给一句大白话', () => {
  const long = skillsToCmds([{ path: '/s/x', description: 'x'.repeat(80) }])[0]
  assert.ok(long.desc.length <= 47 && long.desc.endsWith('…'))
  assert.equal(skillsToCmds([{ path: '/s/y' }])[0].desc, '你装的 skill')
})

// —— @ 文件引用 ——

test('只认末尾正在打的 @，句子中间打完的不再弹', () => {
  assert.equal(atQuery('看下 @src'), 'src')
  assert.equal(atQuery('@'), '')
  assert.equal(atQuery('看下 @src/a.ts 里的问题'), null)
})

test('邮箱里的 @ 不算引用', () => {
  assert.equal(atQuery('发给 a@b.com'), null)
})

test('补全只替换末尾那段，前面写的字一个不动', () => {
  assert.equal(applyAtPick('看下 @sr', 'src/main/x.ts'), '看下 @src/main/x.ts ')
  assert.equal(applyAtPick('@', 'a.ts'), '@a.ts ')
})

test('文件候选拿相对路径当名字（那才是要插进去的东西）', () => {
  const got = filesToCmds([{ rel: 'src/a.ts', name: 'a.ts' }, { rel: 'src/a.ts', name: 'a.ts' }])
  assert.deepEqual(got.map((x) => x.name), ['src/a.ts'])
  assert.equal(got[0].desc, 'a.ts')
  assert.equal(got[0].from, 'file')
})
