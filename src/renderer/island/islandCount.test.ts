import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createT } from '../../shared/i18n/index.ts'
import { projectCountLabel } from './islandCount.ts'

// 英文单复数（2026-09-30）：「1 projects」是语法错
test('英文：1 → "1 project"，其余 → "N projects"', () => {
  const t = createT('en')
  assert.equal(projectCountLabel(t, 1), '1 project')
  assert.equal(projectCountLabel(t, 2), '2 projects')
  assert.equal(projectCountLabel(t, 0), '0 projects')
})

test('中文不分单复数', () => {
  const t = createT('zh')
  assert.equal(projectCountLabel(t, 1), '1 个项目')
  assert.equal(projectCountLabel(t, 3), '3 个项目')
})

test('Island 折叠条走 projectCountLabel，不再直接拼 island.projectCount', () => {
  const src = fs.readFileSync(new URL('./Island.tsx', import.meta.url), 'utf8')
  assert.match(src, /projectCountLabel\(tr, projectCount\)/)
  assert.doesNotMatch(src, /tr\('island\.projectCount'/)
})
