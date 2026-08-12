import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { customSchemaBody } from './customSchema.ts'
import type { LibraryDir } from './taxonomy.ts'

const DIRS: LibraryDir[] = [
  { name: '00-收件箱', purpose: '还没整理的原始素材', role: 'inbox' },
  { name: '课题', purpose: '一个课题一篇，记进展与结论' },
  { name: '_模板', purpose: '新建笔记的模板', role: 'templates' }
]

test('自定义说明书逐条列出目录名与它的一句话', () => {
  const s = customSchemaBody(DIRS)
  for (const d of DIRS) {
    assert.ok(s.includes(d.name), `说明书里没提到 ${d.name}`)
    assert.ok(s.includes(d.purpose), `说明书里没写 ${d.name} 的 purpose`)
  }
})

test('自定义说明书不含内置目录名（否则 agent 会往不存在的目录放东西）', () => {
  const s = customSchemaBody(DIRS)
  for (const gone of ['me/', 'people/', 'methods/', 'domains/']) {
    assert.ok(!s.includes(gone), `说明书里不该出现内置目录 ${gone}`)
  }
})

test('front-matter 硬要求仍然写在说明书里', () => {
  const s = customSchemaBody(DIRS)
  assert.ok(s.includes('summary'))
  assert.ok(s.includes('tags'))
})
