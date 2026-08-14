import { test } from 'node:test'
import assert from 'node:assert'
import { parseSkillFrontmatter } from './parse.ts'

test('单行 name + 单行 description', () => {
  const r = parseSkillFrontmatter('---\nname: foo\ndescription: 一句话说明\n---\n\n正文\n')
  assert.equal(r.name, 'foo')
  assert.equal(r.description, '一句话说明')
})

test('折叠块标量（真实 SKILL.md 最常见的写法，见 .claude/skills/agent-onboarding/SKILL.md）', () => {
  const raw = [
    '---',
    'name: agent-onboarding',
    'description: >',
    '  给 Eas-Term 接入一个新的 AI CLI 时，照着这份做前置工作 ——',
    '  盘清五个注入面、每个面写什么。',
    '  Triggers: 接入新 agent, 集成新 agent.',
    '---',
    '',
    '# 正文标题'
  ].join('\n')
  const r = parseSkillFrontmatter(raw)
  assert.equal(r.name, 'agent-onboarding')
  assert.equal(
    r.description,
    '给 Eas-Term 接入一个新的 AI CLI 时，照着这份做前置工作 —— 盘清五个注入面、每个面写什么。 Triggers: 接入新 agent, 集成新 agent.'
  )
})

test('字面块标量（|）保留换行，不折叠成空格', () => {
  const raw = ['---', 'name: x', 'description: |', '  第一行', '  第二行', '---'].join('\n')
  const r = parseSkillFrontmatter(raw)
  assert.equal(r.description, '第一行\n第二行')
})

test('带引号的单行值会被去掉引号', () => {
  const r = parseSkillFrontmatter('---\nname: "带引号的名字"\ndescription: \'单引号也行\'\n---\n')
  assert.equal(r.name, '带引号的名字')
  assert.equal(r.description, '单引号也行')
})

test('没有 frontmatter（缺 --- 围栏）→ 两个字段都是 null，不抛错', () => {
  const r = parseSkillFrontmatter('# 只是一个普通的 markdown 文件\n没有 frontmatter\n')
  assert.equal(r.name, null)
  assert.equal(r.description, null)
})

test('只有开头 --- 没有结尾 --- → 判定为没有 frontmatter，不抛错、不误吞正文', () => {
  const r = parseSkillFrontmatter('---\nname: 半份文件\n\n后面全是正文，没有第二个 ---\n')
  assert.equal(r.name, null)
  assert.equal(r.description, null)
})

test('空字符串输入不抛错', () => {
  const r = parseSkillFrontmatter('')
  assert.equal(r.name, null)
  assert.equal(r.description, null)
})

test('name 缺失、只有 description', () => {
  const r = parseSkillFrontmatter('---\ndescription: 只有描述没有名字\n---\n')
  assert.equal(r.name, null)
  assert.equal(r.description, '只有描述没有名字')
})

test('description 折叠块标量为空（> 后面紧跟没有缩进的下一个 key）', () => {
  const raw = ['---', 'name: x', 'description: >', 'name2: 这一行没缩进，不属于块标量', '---'].join('\n')
  const r = parseSkillFrontmatter(raw)
  assert.equal(r.description, '')
})

test('折叠块标量中间夹一个空行：拍平展示，不当作段落分隔保留双换行', () => {
  const raw = ['---', 'name: x', 'description: >', '  第一段。', '', '  第二段。', '---'].join('\n')
  const r = parseSkillFrontmatter(raw)
  assert.equal(r.description, '第一段。 第二段。')
})

test('CRLF 换行也能正常解析', () => {
  const raw = '---\r\nname: crlf\r\ndescription: windows 换行\r\n---\r\n'
  const r = parseSkillFrontmatter(raw)
  assert.equal(r.name, 'crlf')
  assert.equal(r.description, 'windows 换行')
})
