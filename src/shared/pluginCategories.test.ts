import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { categoryIdOf, categoryName, MARKET_CATEGORIES } from './pluginCategories.ts'
import { createT } from './i18n/index.ts'

test('中文分类名直接命中', () => {
  assert.equal(categoryIdOf('办公文档'), 'office')
  assert.equal(categoryIdOf('自媒体'), 'media')
  assert.equal(categoryIdOf('设计创意'), 'design')
})

test('英文 / 自家老值映射', () => {
  assert.equal(categoryIdOf('Productivity'), 'productivity')
  assert.equal(categoryIdOf('System'), 'dev')
  assert.equal(categoryIdOf('Developer Tools'), 'dev')
})

test('空 / 认不出 → other', () => {
  assert.equal(categoryIdOf(''), 'other')
  assert.equal(categoryIdOf(undefined), 'other')
  assert.equal(categoryIdOf('随便写的'), 'other')
})

test('每个分类 id 都能查到名字（中文界面 = 分类表里的中文名）', () => {
  const zh = createT('zh')
  for (const c of MARKET_CATEGORIES) assert.equal(categoryName(c.id, zh), c.name)
  assert.equal(categoryName('不存在', zh), '其他')
})

// 2026-09-30：抽屉「发现」区原样显示 registry 的 category，中文界面出现 "Productivity"
test('显示名随语言：英文界面是英文名，中文界面不会露出 registry 里的英文原值', () => {
  const en = createT('en'), zh = createT('zh')
  assert.equal(categoryName(categoryIdOf('Productivity'), en), 'Productivity')
  assert.equal(categoryName(categoryIdOf('Productivity'), zh), '效率工具')
  assert.equal(categoryName(categoryIdOf('办公文档'), en), 'Office & docs')
  assert.equal(categoryName('不存在', en), 'Other')
  for (const c of MARKET_CATEGORIES) assert.doesNotMatch(categoryName(c.id, en), /[\u4e00-\u9fff]/)
})

test('抽屉「发现」区与完整市场弹窗都走 categoryName，不再直接显示 e.category / 各自维护映射表', () => {
  const panel = fs.readFileSync(new URL('../renderer/src/features/canvas/CanvasMarketPanel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(panel, /\{e\.category\}/)
  assert.match(panel, /categoryName\(categoryIdOf\(e\.category\), tr\)/)
  const modal = fs.readFileSync(new URL('../renderer/src/features/canvas/PluginMarketModal.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(modal, /const CATEGORY_KEYS/)
  assert.match(modal, /categoryName\(/)
})

// 2026-09-30 用户拍板新增「效率工具」：Productivity / 效率 → productivity，办公 / office / docs 仍 → office
test('效率工具类：别名映射、显示名、排在办公文档之后', () => {
  for (const raw of ['Productivity', 'productivity', '效率', '效率工具']) assert.equal(categoryIdOf(raw), 'productivity')
  for (const raw of ['办公', '办公文档', 'office']) assert.equal(categoryIdOf(raw), 'office')
  assert.equal(categoryName('productivity', createT('zh')), '效率工具')
  assert.equal(categoryName('productivity', createT('en')), 'Productivity')
  const ids = MARKET_CATEGORIES.map((c) => c.id)
  assert.equal(ids.indexOf('productivity'), ids.indexOf('office') + 1)
  assert.equal(ids.at(-1), 'other')
})

test('自家插件 manifest 的 category 落点', () => {
  const cat = (p: string): string => categoryIdOf(JSON.parse(fs.readFileSync(new URL(`../../${p}/plugin.json`, import.meta.url), 'utf8')).category)
  for (const n of ['board', 'timeline', 'execution-plan']) assert.equal(cat(`resources/plugins/${n}`), 'productivity')
  assert.equal(cat('plugins-store/pomodoro'), 'productivity')
  for (const n of ['excel', 'word', 'powerpoint']) assert.equal(cat(`plugins-store/${n}`), 'office')
})
