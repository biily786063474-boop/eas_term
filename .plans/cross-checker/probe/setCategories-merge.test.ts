// 复现 src/main/skillLibrary/index.ts:379-400 setCategories 的合并逻辑，
// 只把 loadConfig/saveConfig 换成内存变量，其余逐行照抄。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeCategoryAssignment,
  sanitizeLocks,
  dropLocked,
  validateCategoryBatch
} from '../../../src/main/skillLibrary/category.ts'

/** index.ts:386-398 原样搬过来 */
function setCategoriesLogic(
  cfg: { categories?: Record<string, string>; categoryLocks?: string[] },
  raw: unknown,
  valid: Set<string>
) {
  const v = validateCategoryBatch(raw, valid)
  if (!v.ok) return { ok: false as const, error: v.error, nextCategories: cfg.categories }
  const locks = sanitizeLocks(cfg.categoryLocks, valid)
  const { kept, skipped } = dropLocked(v.assignment, locks)
  const cur = sanitizeCategoryAssignment(cfg.categories, valid)
  return { ok: true as const, nextCategories: { ...cur, ...kept }, applied: Object.keys(kept).length, skipped }
}

test('扫不到的 skill：它原有的分类会被这次写入静默抹掉', () => {
  const cfg = {
    categories: {
      '/home/u/.claude/skills/a': '设计',
      '/home/u/.claude/design-skills/b': '设计',   // ← 这个目录这次没扫到
      '/home/u/.claude/design-skills/c': '影像'
    }
  }
  // 模拟 design-skills 这次 scan 失败（改名/权限/挂载没上来），valid 里只剩 a
  const valid = new Set(['/home/u/.claude/skills/a'])
  const r = setCategoriesLogic(cfg, [{ skill: '/home/u/.claude/skills/a', category: '工具' }], valid)
  assert.equal(r.ok, true)
  console.log('  写回的 categories =', JSON.stringify(r.nextCategories))
  assert.deepEqual(r.nextCategories, { '/home/u/.claude/skills/a': '工具' })
  // b、c 的分类记录没了，而 agent 只提交了 a
})

test('对照：disabled 走的是另一条策略，不做存在性过滤', async () => {
  const { sanitizeDisabled } = await import(
    '../../../src/main/skillLibrary/disabled.ts'
  )
  assert.deepEqual(sanitizeDisabled(['/home/u/.claude/design-skills/b']), [
    '/home/u/.claude/design-skills/b'
  ])
})
