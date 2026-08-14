import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { scanSkillDir, readSkillDir } from './scan.ts'

function mkSkill(root: string, name: string, frontmatter = `name: ${name}\ndescription: 测试用\n`): string {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}---\n\n正文\n`)
  return dir
}

test('scanSkillDir：目录不存在 → ok:false，error 说明原因', () => {
  const r = scanSkillDir('/this/path/should/not/exist/xyz-abc')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /不存在/)
})

test('scanSkillDir：路径存在但是个文件而不是目录 → ok:false', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  const file = path.join(root, 'notadir.txt')
  fs.writeFileSync(file, 'x')
  const r = scanSkillDir(file)
  assert.equal(r.ok, false)
})

test('scanSkillDir：空目录 → ok:true，skills 是空数组（不是 ok:false）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepStrictEqual(r.skills, [])
})

test('scanSkillDir：普通子目录 + SKILL.md → 正常扫到', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  mkSkill(root, 'foo')
  mkSkill(root, 'bar')
  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepStrictEqual(r.skills.map((s) => s.name).sort(), ['bar', 'foo'])
})

test('scanSkillDir：子目录没有 SKILL.md → 跳过，不影响其余正常项', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  mkSkill(root, 'good')
  fs.mkdirSync(path.join(root, 'not-a-skill')) // 没有 SKILL.md
  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepStrictEqual(r.skills.map((s) => s.name), ['good'])
})

test('scanSkillDir：隐藏目录（.git 等）不当 skill 扫，即便里面真的有 SKILL.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  mkSkill(root, '.hidden')
  mkSkill(root, 'visible')
  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepStrictEqual(r.skills.map((s) => s.name), ['visible'])
})

test('scanSkillDir：顶层是文件（不是目录）的条目直接跳过', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  mkSkill(root, 'real-skill')
  fs.writeFileSync(path.join(root, 'README.md'), '# 说明')
  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepStrictEqual(r.skills.map((s) => s.name), ['real-skill'])
})

test('scanSkillDir：符号链接指向的真实目录也要被当成 skill 扫到——回归真机验证发现的漏洞', () => {
  // 复现真实场景：~/.claude/design-skills/motion-picker -> 别处的真实目录。
  // 第一版实现只认 Dirent.isDirectory()（不跟随链接），design-skills 应有 11 个，
  // 当时因为这一个符号链接被漏掉，只扫出 10 个。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-elsewhere-'))
  const realSkillDir = mkSkill(elsewhere, 'linked-skill')
  fs.symlinkSync(realSkillDir, path.join(root, 'linked-skill'), 'dir')
  mkSkill(root, 'normal-skill')

  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepStrictEqual(r.skills.map((s) => s.name).sort(), ['linked-skill', 'normal-skill'])
    // path 字段应该是「软链本身的路径」（root 下那个名字），不是 realpath——
    // 这样分类口子（第二半）引用的是用户在这个目录下实际看到的那个入口
    const linked = r.skills.find((s) => s.name === 'linked-skill')
    assert.equal(linked?.path, path.join(root, 'linked-skill'))
  }
})

test('scanSkillDir：断链的符号链接（目标不存在）安全跳过，不抛错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  fs.symlinkSync(path.join(root, 'does-not-exist-target'), path.join(root, 'dangling'), 'dir')
  mkSkill(root, 'ok-skill')
  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepStrictEqual(r.skills.map((s) => s.name), ['ok-skill'])
})

test('scanSkillDir：结果按名称排序（zh locale），不依赖磁盘 readdir 的原始顺序', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  mkSkill(root, 'zebra')
  mkSkill(root, 'apple')
  mkSkill(root, 'mango')
  const r = scanSkillDir(root)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepStrictEqual(r.skills.map((s) => s.name), ['apple', 'mango', 'zebra'])
})

test('readSkillDir：SKILL.md 不存在 → null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  fs.mkdirSync(path.join(root, 'empty-dir'))
  assert.equal(readSkillDir(root, 'empty-dir'), null)
})

test('readSkillDir：frontmatter 里没有 name → 回落成目录名，标 fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  const dir = path.join(root, 'no-name-skill')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\ndescription: 只有描述\n---\n')
  const info = readSkillDir(root, 'no-name-skill')
  assert.equal(info?.name, 'no-name-skill')
  assert.equal(info?.fallback, true)
})

test('readSkillDir：SKILL.md 完全没有 frontmatter（连 --- 都没有）→ 回落成目录名，不抛错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  const dir = path.join(root, 'plain-md')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# 只是个普通标题\n没有 frontmatter\n')
  const info = readSkillDir(root, 'plain-md')
  assert.equal(info?.name, 'plain-md')
  assert.equal(info?.fallback, true)
  assert.equal(info?.description, '')
})

test('readSkillDir：正常 frontmatter → name/description 都取到，没有 fallback 标记', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscan-'))
  mkSkill(root, 'proper-skill', 'name: proper-skill\ndescription: 一句话说明\n')
  const info = readSkillDir(root, 'proper-skill')
  assert.equal(info?.name, 'proper-skill')
  assert.equal(info?.description, '一句话说明')
  assert.equal(info?.fallback, undefined)
})
