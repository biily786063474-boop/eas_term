import { test } from 'node:test'
import assert from 'node:assert'
import { customSchemaBody, customIndexMd, customReadmeText } from './customSchema.ts'
import type { LibraryDir } from './taxonomy.ts'

const DIRS: LibraryDir[] = [
  { name: '00-收件箱', purpose: '还没整理的原始素材', role: 'inbox' },
  { name: '课题', purpose: '一个课题一篇，记进展与结论' },
  { name: '_模板', purpose: '新建笔记的模板', role: 'templates' }
]

// 比 DIRS 多一个 role:"raw" 的目录 —— 专门用来测 index.md/START-HERE.md 对三种
// 特殊角色（inbox/raw/templates）的排除规则，DIRS 本身没有 raw 目录测不到这条。
const DIRS_WITH_RAW: LibraryDir[] = [
  { name: '00-收件箱', purpose: '还没整理的原始素材', role: 'inbox' },
  { name: '课题', purpose: '一个课题一篇，记进展与结论' },
  { name: '素材库', purpose: '原始录音与文章存档', role: 'raw' },
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

test('自定义 index.md 只出现该出现的目录名，不出现内置分区标题', () => {
  const s = customIndexMd(DIRS_WITH_RAW)
  assert.ok(s.includes('## 课题'), '普通目录该单独开一个分区')
  for (const gone of ['people', 'methods', 'domains', 'projects']) {
    assert.ok(!s.includes(`## ${gone}`), `不该出现内置分区 ## ${gone}`)
  }
})

test('role 为 inbox/raw/templates 的目录不该出现在 index.md 的分区里', () => {
  const s = customIndexMd(DIRS_WITH_RAW)
  assert.ok(!s.includes('## 00-收件箱'), 'inbox 目录不该单独成一个分区')
  assert.ok(!s.includes('## 素材库'), 'raw 目录不该单独成一个分区')
  assert.ok(!s.includes('## _模板'), 'templates 目录不该单独成一个分区')
})

test('START-HERE.md 用配置的 inbox 名，不出现内置的 sources/', () => {
  const s = customReadmeText(DIRS_WITH_RAW)
  assert.ok(s.includes('`00-收件箱/`'), '该出现配置的 inbox 目录名')
  assert.ok(!s.includes('sources/'), '不该出现内置的 sources/')
})

test('只有 inbox、没有 raw 目录时，只读不改那句话读得通（不出现空目录名）', () => {
  const s = customReadmeText(DIRS) // DIRS 没有 role:"raw" 的目录
  assert.ok(!s.includes('``'), '不该出现空的目录名反引号对')
  assert.ok(!s.includes('` 和 `'), '只有一个目录时不该拼出两项之间的"和"')
  // 锚定到句首的 ** 加粗标记，而不是只查子串——否则"和 `00-收件箱/` 里的原件"这种
  // 前面多出一截悬空"和"的坏文案，也会因为后半截子串对得上而被判定通过（真的踩过这个坑）。
  assert.ok(
    s.includes('**`00-收件箱/` 里的原件，agent 只读不改。**'),
    '只有 inbox 时应该单独、干净地引用这一个目录，句子读得通'
  )
})
