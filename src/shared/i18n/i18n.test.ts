import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLang, translate, placeholders, zh, en, isLangPref, localeOf } from './index.ts'

test('跟随系统：zh 开头的系统语言用中文，其余一律英文；显式选择优先', () => {
  for (const loc of ['zh-CN', 'zh-Hans-CN', 'zh-TW', 'zh']) assert.equal(resolveLang('system', loc), 'zh', loc)
  for (const loc of ['en-US', 'ja-JP', 'de', '', undefined]) assert.equal(resolveLang('system', loc), 'en', String(loc))
  assert.equal(resolveLang('zh', 'en-US'), 'zh')
  assert.equal(resolveLang('en', 'zh-CN'), 'en')
  assert.equal(resolveLang(undefined, 'zh-CN'), 'zh')
})

test('中英词典键完全一致，且每个键的占位符集合相同', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const k of Object.keys(zh) as (keyof typeof zh)[]) {
    assert.deepEqual(placeholders(en[k]), placeholders(zh[k]), `占位符不一致：${k}`)
    assert.ok(en[k].trim(), `英文为空：${k}`)
  }
})

test('英文词典里不许残留中文（语言名「中文」除外）', () => {
  for (const [k, v] of Object.entries(en)) {
    if (k === 'settings.language.zh') continue
    assert.equal(/[一-鿿]/.test(v), false, `英文词典含中文：${k} = ${v}`)
  }
})

test('占位符替换；缺参数时原样保留，不吞掉', () => {
  assert.equal(translate('zh', 'dock.runningFor', { dur: '3m05s' }), '跑了 3m05s')
  assert.equal(translate('en', 'dock.runningFor', { dur: '3m05s' }), 'running 3m05s')
  assert.equal(translate('en', 'dock.runningFor'), 'running {dur}')
})

test('isLangPref / localeOf', () => {
  assert.equal(isLangPref('system'), true)
  assert.equal(isLangPref('fr'), false)
  assert.equal(localeOf('zh'), 'zh-CN')
  assert.equal(localeOf('en'), 'en-US')
})

test('各区域词典之间键名不重复（汇总时后者会静默覆盖前者）', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = path.join(import.meta.dirname, 'dict')
  const seen = new Map<string, string>()
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.zh.ts'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\s*'([^']+)':/gm)) {
      assert.equal(seen.has(m[1]), false, `键 ${m[1]} 同时出现在 ${seen.get(m[1])} 和 ${f}`)
      seen.set(m[1], f)
    }
  }
  assert.equal(seen.size, Object.keys(zh).length)
})
