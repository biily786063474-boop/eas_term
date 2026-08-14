import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { insideRoot, planCopySkill, planWriteSkillFile, copySkillDir, copyDirRecursive } from './write.ts'

const ROOTS = ['/Users/me/.claude/skills', '/Users/me/.claude/design-skills']

// ── insideRoot ───────────────────────────────────────────────────────────

test('insideRoot：根本身、根下的路径都算在里面', () => {
  assert.equal(insideRoot('/Users/me/.claude/skills', ROOTS), '/Users/me/.claude/skills')
  assert.equal(insideRoot('/Users/me/.claude/skills/foo/SKILL.md', ROOTS), '/Users/me/.claude/skills')
})

test('insideRoot：前缀像但不是同一个目录 → 不算（不能拿 startsWith 硬比字符串）', () => {
  assert.equal(insideRoot('/Users/me/.claude/skills-backup/foo', ROOTS), null)
  assert.equal(insideRoot('/Users/me/.claude/skillsX', ROOTS), null)
})

test('insideRoot：完全无关的位置 → null', () => {
  assert.equal(insideRoot('/Users/me/.ssh/id_rsa', ROOTS), null)
  assert.equal(insideRoot('/etc/passwd', ROOTS), null)
})

test('insideRoot：根写成带结尾斜杠也认', () => {
  assert.equal(insideRoot('/Users/me/.claude/skills/foo', ['/Users/me/.claude/skills/']), '/Users/me/.claude/skills')
})

// ── planCopySkill ────────────────────────────────────────────────────────

const okInput = {
  srcReal: '/Users/me/.claude/skills/foo',
  srcHasSkillMd: true,
  destDirReal: '/Users/me/.claude/design-skills',
  roots: ROOTS,
  destExists: false
}

test('planCopySkill：正常一条 → 落点是目标目录下的同名目录', () => {
  const r = planCopySkill(okInput)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.dest, '/Users/me/.claude/design-skills/foo')
    assert.equal(r.name, 'foo')
  }
})

test('planCopySkill：重名 → 拒绝，且标出 duplicate（不覆盖、不自动改名）', () => {
  const r = planCopySkill({ ...okInput, destExists: true })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.duplicate, true)
    assert.match(r.error, /已经有一个叫「foo」的/)
  }
})

test('planCopySkill：源里没有 SKILL.md → 拒绝', () => {
  const r = planCopySkill({ ...okInput, srcHasSkillMd: false })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /SKILL\.md/)
})

test('planCopySkill：源不在任何已登记目录里 → 拒绝（写边界，不是 UI 约束）', () => {
  const r = planCopySkill({ ...okInput, srcReal: '/Users/me/Downloads/evil' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /源 skill 不在/)
})

test('planCopySkill：目标不是已登记目录 → 拒绝', () => {
  const r = planCopySkill({ ...okInput, destDirReal: '/Users/me/Documents' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /不是一个已登记的 skill 目录/)
})

test('planCopySkill：目标是已登记目录下的子目录也不行（只能落在根那一层）', () => {
  const r = planCopySkill({ ...okInput, destDirReal: '/Users/me/.claude/design-skills/nested' })
  assert.equal(r.ok, false)
})

test('planCopySkill：粘回它自己所在的目录 → 拒绝（会撞上自己）', () => {
  const r = planCopySkill({ ...okInput, destDirReal: '/Users/me/.claude/skills', destExists: true })
  assert.equal(r.ok, false)
})

test('planCopySkill：源路径不是绝对路径 → 拒绝', () => {
  const r = planCopySkill({ ...okInput, srcReal: 'foo' })
  assert.equal(r.ok, false)
})

// ── planWriteSkillFile ───────────────────────────────────────────────────

test('planWriteSkillFile：skill 里的文件 → 放行', () => {
  const r = planWriteSkillFile({
    fileReal: '/Users/me/.claude/skills/foo/SKILL.md',
    roots: ROOTS,
    isExistingFile: true
  })
  assert.equal(r.ok, true)
})

test('planWriteSkillFile：更深层的文件也放行', () => {
  const r = planWriteSkillFile({
    fileReal: '/Users/me/.claude/skills/foo/references/a.md',
    roots: ROOTS,
    isExistingFile: true
  })
  assert.equal(r.ok, true)
})

test('planWriteSkillFile：skill 根目录下的散文件 → 拒绝（层数不够）', () => {
  const r = planWriteSkillFile({
    fileReal: '/Users/me/.claude/skills/README.md',
    roots: ROOTS,
    isExistingFile: true
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /散文件/)
})

test('planWriteSkillFile：边界外的路径 → 拒绝', () => {
  const r = planWriteSkillFile({ fileReal: '/Users/me/.zshrc', roots: ROOTS, isExistingFile: true })
  assert.equal(r.ok, false)
})

test('planWriteSkillFile：文件不存在 → 拒绝（这条口子只改已有文件，不新建）', () => {
  const r = planWriteSkillFile({
    fileReal: '/Users/me/.claude/skills/foo/new.md',
    roots: ROOTS,
    isExistingFile: false
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /不存在/)
})

// ── 真实落盘：临时名 → 改名，失败不留半个残缺目录 ──────────────────────────

test('copySkillDir：正常复制，内容与子目录都在', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcopy-'))
  const src = path.join(root, 'a', 'foo')
  fs.mkdirSync(path.join(src, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(src, 'SKILL.md'), 'hello')
  fs.writeFileSync(path.join(src, 'scripts', 'go.sh'), 'echo hi')
  const dest = path.join(root, 'b', 'foo')
  fs.mkdirSync(path.join(root, 'b'), { recursive: true })

  const r = copySkillDir(src, dest)
  assert.equal(r.ok, true)
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'hello')
  assert.equal(fs.readFileSync(path.join(dest, 'scripts', 'go.sh'), 'utf8'), 'echo hi')
  // 临时目录已经改名走了，不该有残留
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'b')).filter((n) => n.startsWith('.eas-copying')),
    []
  )
})

test('copySkillDir：源读不出来 → 失败，落点上不留任何东西', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcopy-'))
  const dest = path.join(root, 'foo')
  const r = copySkillDir(path.join(root, 'does-not-exist'), dest)
  assert.equal(r.ok, false)
  assert.equal(fs.existsSync(dest), false)
  assert.deepStrictEqual(fs.readdirSync(root), [])
})

test('copySkillDir：落点在这中间被别人占了 → 不覆盖，报重名', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcopy-'))
  const src = path.join(root, 'foo')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, 'SKILL.md'), 'new')
  const dest = path.join(root, 'dst', 'foo')
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'SKILL.md'), 'old')

  const r = copySkillDir(src, dest)
  assert.equal(r.ok, false)
  // 原来的内容一个字节都没被动
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'old')
})

test('copyDirRecursive：符号链接按链接复制，不跟随（不然一个指向 home 的软链会把 home 拷进去）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcopy-'))
  const outside = path.join(root, 'outside')
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x')
  const src = path.join(root, 'src')
  fs.mkdirSync(src, { recursive: true })
  fs.symlinkSync(outside, path.join(src, 'link'))

  const dest = path.join(root, 'dest')
  copyDirRecursive(src, dest)
  assert.equal(fs.lstatSync(path.join(dest, 'link')).isSymbolicLink(), true)
})
