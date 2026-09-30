// 创作参考英文显示层：蓝图对照齐全、设计选型库映射无中文残留、词条本地化只动该动的地方。
// 测试按中文界面跑（渲染层 i18n 在 Node 里默认中文），英文路径通过显式传 en 参数验证。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { localizeTerm, termName, groupLabel, cat2Label, cat2Desc, blockLabel, type DictEnBundle } from './dictEn.ts'
import {
  localizeDesignTitle, localizeDesignCorpus, designShortName, designServiceLabel, designNote, designPrompt, type DesignSystem
} from './designSystems.ts'
import { blueprintText } from './blueprintEn.ts'

const CJK = /[一-鿿]/
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8')) as T

type Bp = { id: string; name: string; intent: string; platform: string; slots: { block: string; note: string }[] }
const BP = readJson<{ blueprints: Bp[] }>('./blueprints.json').blueprints
const BP_EN = readJson<{ blueprints: Record<string, { name: string; intent: string; notes: Record<string, string> }> }>('./blueprints.en.json').blueprints
const DICT_EN = readJson<DictEnBundle>('./dictionary-bundle.en.json')
const DS = readJson<DesignSystem[]>('./design-systems.json')

test('蓝图英文对照覆盖每张蓝图、每个区块，且没有中文残留', () => {
  for (const b of BP) {
    const e = BP_EN[b.id]
    assert.ok(e, `${b.id} 没有英文`)
    assert.ok(e.name && !CJK.test(e.name) && e.intent && !CJK.test(e.intent), b.id)
    assert.deepEqual(Object.keys(e.notes).sort(), b.slots.map((s) => s.block).sort(), `${b.id} 的区块说明对不上`)
    for (const v of Object.values(e.notes)) assert.ok(v && !CJK.test(v), `${b.id}: ${v}`)
    // 区块名英文与词条对照共用一份（taxonomy.blocks）
    for (const s of b.slots) assert.ok(DICT_EN.taxonomy.blocks[s.block], `区块「${s.block}」缺英文名`)
  }
  assert.deepEqual(Object.keys(BP_EN).sort(), BP.map((b) => b.id).sort(), 'blueprints.en.json 里有多余的蓝图')
})

test('蓝图显示层：中文界面原样，英文界面按 id 覆盖；筛选键不变', () => {
  const b = BP[0]
  const zh = blueprintText(b, false)
  assert.equal(zh.name, b.name)
  assert.equal(zh.note(b.slots[0].block, b.slots[0].note), b.slots[0].note)
  const en = blueprintText(b, true)
  assert.equal(en.name, BP_EN[b.id].name)
  assert.equal(en.note(b.slots[0].block, b.slots[0].note), BP_EN[b.id].notes[b.slots[0].block])
  assert.equal(b.platform, '移动', '数据里的端仍是中文键')
})

const bundle: DictEnBundle = {
  version: 1,
  taxonomy: { groups: { '前端 · 组件': 'Frontend · Components' }, categories: { motion: 'Motion' }, blocks: { 导航栏: 'Nav bar' }, names: { 输入与补全: ['Input & autocomplete', 'Handling input'] } },
  terms: { t1: { hash: 'x', logic: 'EN logic', prompt: 'EN prompt', svg: { 按钮: 'Button' } } }
}
const term = { id: 't1', zh: '防抖', en: 'Debounce', logic: '中文解释', prompt: '中文提示词', svg: '<svg><text x="按钮">按钮</text><text>别的</text></svg>' }

test('localizeTerm 换解释 / 提示词 / 配图文字节点，不碰属性；没对照的文字原样', () => {
  const r = localizeTerm(term, bundle)
  assert.equal(r.logic, 'EN logic')
  assert.equal(r.prompt, 'EN prompt')
  assert.equal(r.svg, '<svg><text x="按钮">Button</text><text>别的</text></svg>')
  assert.equal(r.zh, '防抖', '中文名是筛选 / 身份字段，不改')
})

test('中文界面（en=null）、自建词条、缺对照的词条都原样返回', () => {
  assert.equal(localizeTerm(term, null), term)
  const own = { ...term, user: true }
  assert.equal(localizeTerm(own, bundle), own)
  const missing = { ...term, id: 'nope' }
  assert.equal(localizeTerm(missing, bundle), missing)
  assert.equal(termName(term, null), '防抖')
  assert.equal(termName(term, bundle), 'Debounce')
  assert.equal(termName({ zh: '自建', en: '' }, bundle), '自建')
})

test('分类 / 区块名：有对照用英文，没有回退中文', () => {
  assert.equal(groupLabel('前端 · 组件', bundle), 'Frontend · Components')
  assert.equal(groupLabel('前端 · 视觉', bundle), '前端 · 视觉')
  assert.equal(cat2Label('输入与补全', bundle), 'Input & autocomplete')
  assert.equal(cat2Label('没译的', bundle), '没译的')
  assert.equal(cat2Desc('没译的', '原说明', bundle), '原说明')
  assert.equal(blockLabel('导航栏', bundle), 'Nav bar')
  assert.equal(blockLabel('导航栏', null), '导航栏')
})

test('设计选型库：307 条的标题 / 短名 / 摘要 / 分类 / 说明在英文下无中文残留', () => {
  for (const s of DS) {
    for (const v of [localizeDesignTitle(s.title, true), designShortName(s, true), localizeDesignCorpus(s.corpus, true), ...s.services.map((x) => designServiceLabel(x, true)), designNote(s.classificationNote, true) ?? ''])
      assert.ok(!CJK.test(v), `${s.slug}: ${v}`)
  }
})

test('设计选型库：中文界面逐字节不变', () => {
  for (const s of DS) {
    assert.equal(localizeDesignTitle(s.title, false), s.title)
    assert.equal(localizeDesignCorpus(s.corpus, false), s.corpus)
    assert.equal(designShortName(s, false), s.title.split(' Design')[0].split(' 设计系统')[0])
  }
  // 中文提示词与迁移前的拼法一致
  const s = DS[0]
  const colors = designPrompt(s, 'colors')
  const key = s.corpus.split('\n').find((line) => line.includes('关键色板')) ?? ''
  assert.equal(colors, '请以「' + s.title + '」作为当前任务的设计参考。\n' + '\n只参考配色。\n' + key + '\n' + s.swatch.map((c) => c.n + '：' + c.v).join('\n') +
    '\n\n保留当前项目的字体、圆角、布局、组件交互和动效。不要照搬参考产品的界面结构；先说明颜色映射再实现。')
})

test('标题映射不到的中文片段整段保留原文，不拼半中半英', () => {
  assert.equal(localizeDesignTitle('Foo · 从没见过 · 设计套件', true), 'Foo · 从没见过 · 设计套件')
  assert.equal(localizeDesignTitle('Atmospheric Data Console · 数据控制台 · 设计套件', true), 'Atmospheric Data Console · Design Kit')
  assert.equal(localizeDesignTitle('ElevenLabs 设计系统 Design Kit — Warm Neutral Layout', true), 'ElevenLabs Design Kit — Warm Neutral Layout')
})
