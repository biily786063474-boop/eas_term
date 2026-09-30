import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { decideInitialLang } from './initialLang.ts'

const dir = '/u'
const has = (...names: string[]) => (p: string) => names.some((n) => p === path.join(dir, n))

test('用过英文适配之前版本（有项目列表或画布存档）→ 中文，不跟随系统', () => {
  assert.equal(decideInitialLang(dir, has('projects.json')), 'zh')
  assert.equal(decideInitialLang(dir, has('canvas.json')), 'zh')
})

test('全新安装（没有任何应用数据）→ 跟随系统', () => {
  assert.equal(decideInitialLang(dir, has()), 'system')
  // prefs.json 在不在不算数：它只是开关存档，新老用户都可能有
  assert.equal(decideInitialLang(dir, has('prefs.json')), 'system')
})
