import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  applyExposure,
  hiddenClaudeNames,
  hiddenCodexPaths,
  hiddenSkillsFor,
  sanitizeExposureConfig
} from './exposure.ts'
import { isSkillExposed } from '../../shared/skillExposure.ts'

const dirs = [
  {
    skills: [
      { path: '/h/.claude/skills/alpha', name: 'alpha' },
      { path: '/h/.claude/skills/beta-dir', name: 'beta' },
      { path: '/h/.claude/skills/eas-term', name: 'eas-term' }
    ]
  }
]

test('缺省配置 = 全部暴露（现状不变）', () => {
  const cfg = sanitizeExposureConfig(undefined)
  assert.deepStrictEqual(cfg, { exposeByDefault: true, exposure: {} })
  assert.deepStrictEqual(hiddenClaudeNames(cfg, dirs), [])
})

test('清洗：只收绝对路径 + on/off，exposeByDefault 只有显式 false 才关', () => {
  const cfg = sanitizeExposureConfig({
    exposeByDefault: 'no',
    exposure: { '/a': 'off', 'rel/b': 'off', '/c': 'maybe', '/d': 'on' }
  })
  assert.strictEqual(cfg.exposeByDefault, true)
  assert.deepStrictEqual(cfg.exposure, { '/a': 'off', '/d': 'on' })
})

test('全局关：全部隐藏，但 Eas-Term 自己的能力指引永不隐藏', () => {
  const cfg = sanitizeExposureConfig({ exposeByDefault: false })
  assert.deepStrictEqual(hiddenClaudeNames(cfg, dirs), ['alpha', 'beta', 'beta-dir'])
  assert.strictEqual(isSkillExposed(cfg, '/h/.claude/skills/eas-term'), true)
})

test('全局关 + 单项打开：例外优先于全局', () => {
  const cfg = sanitizeExposureConfig({ exposeByDefault: false, exposure: { '/h/.claude/skills/alpha': 'on' } })
  assert.deepStrictEqual(hiddenClaudeNames(cfg, dirs), ['beta', 'beta-dir'])
})

test('全局开 + 单项关闭：只隐藏那一个', () => {
  const cfg = sanitizeExposureConfig({ exposure: { '/h/.claude/skills/beta-dir': 'off' } })
  assert.deepStrictEqual(hiddenClaudeNames(cfg, dirs), ['beta', 'beta-dir'])
})

test('豁免压过单项关闭：eas-term 就算被单独关也照样暴露', () => {
  const cfg = sanitizeExposureConfig({ exposure: { '/h/.claude/skills/eas-term': 'off' } })
  assert.deepStrictEqual(hiddenClaudeNames(cfg, dirs), [])
})

test('Codex 给 SKILL.md 路径；软链的 realpath 一并给出', () => {
  const cfg = sanitizeExposureConfig({ exposeByDefault: false })
  const real = (p: string): string => (p.includes('beta-dir') ? '/real/beta/SKILL.md' : p)
  assert.deepStrictEqual(hiddenCodexPaths(cfg, dirs, real), [
    '/h/.claude/skills/alpha/SKILL.md',
    '/h/.claude/skills/beta-dir/SKILL.md',
    '/real/beta/SKILL.md'
  ])
})

test('applyExposure：设成与全局相同的值 = 复位，不留假例外', () => {
  const cfg = sanitizeExposureConfig({ exposeByDefault: true, exposure: { '/x': 'off' } })
  assert.deepStrictEqual(applyExposure(cfg, '/x', 'on'), {})
  assert.deepStrictEqual(applyExposure(cfg, '/y', 'off'), { '/x': 'off', '/y': 'off' })
  assert.deepStrictEqual(applyExposure(cfg, '/x', null), {})
})

test('hiddenSkillsFor：真实目录扫描，按 CLI 分别落名字 / 路径；全开时不扫盘', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exposure-'))
  const home = path.join(root, 'home')
  const userData = path.join(root, 'ud')
  const proj = path.join(root, 'proj')
  const mk = (dir: string, name: string): void => {
    fs.mkdirSync(path.join(dir, name), { recursive: true })
    fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\nbody\n`)
  }
  mk(path.join(home, '.claude', 'skills'), 'g1')
  mk(path.join(proj, '.claude', 'skills'), 'p1')
  mk(path.join(home, '.codex', 'skills'), 'c1')
  mk(path.join(proj, '.agents', 'skills'), 'a1')
  fs.mkdirSync(userData, { recursive: true })

  const base = { userData, home, cwd: proj, root: proj }
  assert.deepStrictEqual(hiddenSkillsFor({ ...base, cli: 'claude' }), { claudeNames: [], codexPaths: [] })

  fs.writeFileSync(path.join(userData, 'skills.json'), JSON.stringify({ exposeByDefault: false }))
  assert.deepStrictEqual(hiddenSkillsFor({ ...base, cli: 'claude' }).claudeNames, ['g1', 'p1'])
  const cx = hiddenSkillsFor({ ...base, cli: 'codex' }).codexPaths.map((p) => path.basename(path.dirname(p)))
  assert.deepStrictEqual([...new Set(cx)].sort(), ['a1', 'c1'])
  assert.deepStrictEqual(hiddenSkillsFor({ ...base, cli: 'omp' }), { claudeNames: [], codexPaths: [] })
  fs.rmSync(root, { recursive: true, force: true })
})
