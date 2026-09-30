import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtin, builtinEntries } from './builtin.mjs'
import { check } from './lexicon.mjs'

const rules = builtin()
const ids = (text: string, platform?: string) => check(text, rules, { platform }).map((h: any) => h.id)
const words = (text: string, platform?: string) => check(text, rules, { platform }).map((h: any) => h.word)

test('内置词库：每条都有依据链接与原文摘录，法律类链接指向政府站', () => {
  const all = builtinEntries()
  assert.ok(all.length >= 15)
  for (const e of all) {
    assert.match(e.basis.url, /^https:\/\//, e.id)
    assert.ok(e.basis.quote && e.basis.quote.length > 10, `${e.id} 缺原文摘录`)
    assert.ok(e.basis.clause, `${e.id} 缺条款号`)
    if (e.confidence === 'law') assert.match(e.basis.url, /\.gov\.cn\//, e.id)
  }
})

test('绝对化用语：推销口吻会提示', () => {
  assert.deepEqual(words('这是最好用的 AI 终端，行业第一，史无前例'), ['最好用', '行业第一', '史无前例'])
  assert.ok(ids('国家级的体验').includes('law-grade'))
  assert.ok(ids('Eas-Term is the No.1 workbench').includes('law-first'))
})

test('执法指南不适用的说法 / 日常用语不误报', () => {
  for (const ok of [
    '第一次做独立开发，第一步先画原型',           // 时空顺序、序数
    '最近在做一个终端，最后一步是打包',             // 「最近」「最后」不是评价
    '最大化窗口后再最小化',                         // 产品术语
    '最好先备份一下配置',                           // 建议口吻
    '最低配置要求 macOS 12',                        // 规格说明
    '唯一的缺点是界面只有中文',                     // 自我陈述缺点
    '这是我第一个 102 天的项目'                     // 序数
  ]) assert.deepEqual(ids(ok), [], ok)
})

test('承诺保证：投资与教育培训两类', () => {
  assert.ok(ids('稳赚不赔零风险').includes('law-guarantee-invest'))
  assert.ok(ids('学完包过，100%通过').includes('law-guarantee-edu'))
})

test('小红书：联系方式（含拆字、全角）、手机号、网址、二维码都提示；其他平台不查小红书规则', () => {
  const t = '想试的加 微 信 或 ＶＸ，电话 138 1234 5678，下载 eas.biily.top，扫码进群'
  const hit = ids(t, 'xiaohongshu')
  for (const id of ['xhs-contact', 'xhs-contact-raw', 'xhs-link']) assert.ok(hit.includes(id), id)
  assert.ok(!ids(t, 'x').some((id: string) => id.startsWith('xhs-')))
})

test('他平台引导：引导去搜 / 关注才算，只提到名字不算；不拿平台自己的名字报自己', () => {
  assert.ok(ids('完整版去 B站搜 Eas-Term', 'xiaohongshu').includes('xhs-other-platform'))
  assert.ok(ids('关注我的抖音号', 'bilibili').includes('bili-other-platform'))
  assert.deepEqual(ids('这个视频在抖音上也很火吗？不知道', 'xiaohongshu').filter((i: string) => i === 'xhs-other-platform'), [])
  assert.deepEqual(ids('小红书上搜 Eas-Term', 'xiaohongshu').filter((i: string) => i === 'xhs-other-platform'), [])
})

test('英文单词里的 wx / vx / qq 不误报', () => {
  assert.deepEqual(ids('devx toolkit, wxWidgets, qqq', 'xiaohongshu'), [])
})

test('视频号与海外平台没有平台规则词条（原文里没有对应条款），只剩法律类', () => {
  for (const p of ['channels', 'x', 'reddit']) {
    const hit = ids('加微信 vx123 看 https://eas.biily.top', p)
    assert.deepEqual(hit, [], p)
  }
})

test('P1 那批真实文案：X 与 B站干净，小红书无提示', () => {
  const x = "I'm a designer in my second year of writing code.\n\nFor the past 102 days I've been building my own AI workbench, solo: Claude Code, Codex, terminals and web pages, all on one infinite canvas.\n\nEas-Term is in beta on macOS and Windows. Want a build? Reply or DM me."
  assert.deepEqual(ids(x, 'x'), [])
  assert.deepEqual(ids('第二年写代码的设计师，一个人做了 102 天。\n\nClaude Code、Codex、终端和网页，全放在一张无限画布上。\n\n现在内测中，想试的评论区说一声。', 'xiaohongshu'), [])
})
