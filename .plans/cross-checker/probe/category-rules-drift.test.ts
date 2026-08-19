// 探针：分类名的规则在「AI 写入」和「面板手动写入」两条路上不一样。
// 复刻 src/main/skillLibrary/index.ts 里那三个手动口子的校验逻辑（逐行照抄，
// 只把 loadConfig/saveConfig 换成内存对象），跟 category.ts 的写入端校验对撞。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateCategoryBatch,
  sanitizeCategoryAssignment,
  sanitizeCategoryNames,
  sanitizeLocks,
  dropLocked,
  CATEGORY_NAME_MAX,
  UNCATEGORIZED
} from '../../../src/main/skillLibrary/category.ts'

type Cfg = { categories?: Record<string, string>; categoryLocks?: string[]; categoryNames?: string[] }

/** index.ts:312-322 addCategoryName 原样搬过来 */
function addCategoryName(cfg: Cfg, name: unknown) {
  if (typeof name !== 'string') return { ok: false as const, error: '分类名必须是字符串' }
  const n = name.trim()
  if (!n) return { ok: false as const, error: '分类名不能为空' }
  if (n.length > CATEGORY_NAME_MAX) return { ok: false as const, error: `分类名不能超过 ${CATEGORY_NAME_MAX} 个字` }
  if (n === UNCATEGORIZED) return { ok: false as const, error: `「${UNCATEGORIZED}」是保留名字，换一个` }
  const cur = sanitizeCategoryNames(cfg.categoryNames)
  if (cur.includes(n)) return { ok: false as const, error: '已经有同名分类了' }
  return { ok: true as const, next: { ...cfg, categoryNames: [...cur, n] } }
}

/** index.ts:346-377 assignCategory 原样搬过来（只走「分进某个分类」那一支） */
function assignCategory(cfg: Cfg, skillPath: string, category: string) {
  const cats = { ...(cfg.categories ?? {}) }
  const locks = new Set(Array.isArray(cfg.categoryLocks) ? cfg.categoryLocks : [])
  const raw = category.trim()
  if (!raw || raw === UNCATEGORIZED) {
    delete cats[skillPath]
    locks.delete(skillPath)
    return { ok: true as const, next: { ...cfg, categories: cats, categoryLocks: [...locks] } }
  }
  if (raw.length > CATEGORY_NAME_MAX) return { ok: false as const, error: `分类名不能超过 ${CATEGORY_NAME_MAX} 个字` }
  cats[skillPath] = raw
  locks.add(skillPath)
  const names = sanitizeCategoryNames(cfg.categoryNames)
  return {
    ok: true as const,
    next: {
      ...cfg,
      categories: cats,
      categoryLocks: [...locks],
      categoryNames: names.includes(raw) ? names : [...names, raw]
    }
  }
}

/** index.ts:379-400 setCategories 原样搬过来 */
function setCategories(cfg: Cfg, raw: unknown, valid: Set<string>) {
  const v = validateCategoryBatch(raw, valid)
  if (!v.ok) return { ok: false as const, error: v.error, next: cfg }
  const locks = sanitizeLocks(cfg.categoryLocks, valid)
  const { kept, skipped } = dropLocked(v.assignment, locks)
  const cur = sanitizeCategoryAssignment(cfg.categories, valid)
  return {
    ok: true as const,
    applied: Object.keys(kept).length,
    skippedLocked: skipped,
    next: { ...cfg, categories: { ...cur, ...kept } }
  }
}

const A = '/home/u/.claude/skills/a'
const B = '/home/u/.claude/skills/b'
const VALID = new Set([A, B])

test('带换行的分类名：手动口子收得下，AI 口子写不回 —— 同一个字符串两套规矩', () => {
  // 1. 用户在面板「新建分类」里粘进一个带换行的名字（比如从别处复制过来的）
  const r1 = addCategoryName({}, '设计\n品牌')
  assert.equal(r1.ok, true, 'addCategoryName 没有拦换行')
  const cfg1 = (r1 as { next: Cfg }).next

  // 2. 用户把 a 拖进去
  const r2 = assignCategory(cfg1, A, '设计\n品牌')
  assert.equal(r2.ok, true, 'assignCategory 也没有拦换行')
  const cfg2 = (r2 as { next: Cfg }).next
  assert.equal(cfg2.categories![A], '设计\n品牌')

  // 3. 读取端（skill_list / 面板分组走的都是它）原样放行 —— agent 会看到这个名字
  const shown = sanitizeCategoryAssignment(cfg2.categories, VALID)
  assert.equal(shown[A], '设计\n品牌', '读取端也没有拦换行，agent 拿到的就是它')

  // 4. agent 照抄 skill_list 给的分类名，把 b 也分进同一类 → 整批拒绝
  const r3 = setCategories(cfg2, [{ skill: B, category: '设计\n品牌' }], VALID)
  assert.equal(r3.ok, false, '写入端拒绝了同一个字符串')
  console.log('  整批被拒，错误信息 =', (r3 as { error: string }).error)
})

test('制表符同理：写入端拦，另外三处都不拦', () => {
  assert.equal(addCategoryName({}, '设计\t品牌').ok, true)
  assert.deepEqual(sanitizeCategoryNames(['设计\t品牌']), ['设计\t品牌'])
  assert.deepEqual(sanitizeCategoryAssignment({ [A]: '设计\t品牌' }, VALID), { [A]: '设计\t品牌' })
  assert.equal(validateCategoryBatch([{ skill: A, category: '设计\t品牌' }], VALID).ok, false)
})

test('整批拒绝只报第一类错：形状错遮住了「skill 不存在」，agent 要来回两趟', () => {
  const r = validateCategoryBatch(
    [
      { skill: A, category: '设计' },
      { skill: 123, category: '设计' }, // 形状错
      { skill: '/nope/x', category: '设计' } // 不存在
    ],
    VALID
  )
  assert.equal(r.ok, false)
  const err = (r as { error: string }).error
  console.log('  第一次的错误信息 =', err)
  assert.match(err, /格式不对/)
  assert.doesNotMatch(err, /不存在/, '同一次里「skill 不存在」没有被一起报出来')

  // agent 照着改完形状再交一次 —— 又被拒一次，这回才轮到「不存在」
  const r2 = validateCategoryBatch(
    [
      { skill: A, category: '设计' },
      { skill: B, category: '设计' },
      { skill: '/nope/x', category: '设计' }
    ],
    VALID
  )
  assert.equal(r2.ok, false)
  console.log('  第二次的错误信息 =', (r2 as { error: string }).error)
  assert.match((r2 as { error: string }).error, /不存在/)
})

test('复合场景：一次扫盘失败 + 一次 AI 分类 → 手动分类被抹、锁还在、之后谁也改不动', () => {
  // 用户手动把 a、b 都分好了（手动 = 上锁）
  let cfg: Cfg = {}
  cfg = (assignCategory(cfg, A, '设计') as { next: Cfg }).next
  cfg = (assignCategory(cfg, B, '影像') as { next: Cfg }).next
  assert.deepEqual(cfg.categories, { [A]: '设计', [B]: '影像' })
  assert.deepEqual(cfg.categoryLocks, [A, B])

  // b 所在的目录这次扫不出来（改名 / 权限 / 外挂盘没上来），valid 里只剩 a
  const validNow = new Set([A])
  const r = setCategories(cfg, [{ skill: A, category: '工具' }], validNow)
  assert.equal(r.ok, true)
  const after = (r as { next: Cfg }).next

  // b 的分类没了，锁却还在（saveConfig 只 patch categories，不动 categoryLocks）
  assert.equal(after.categories![B], undefined, 'b 的手动分类被这次写入抹掉了')
  assert.deepEqual(after.categoryLocks, [A, B], '锁原样保留 → b 成了「没有分类但被锁住」')
  console.log('  抹掉之后 categories =', JSON.stringify(after.categories))

  // a 是手动锁着的，AI 这一批对它其实没生效
  assert.deepEqual((r as { skippedLocked: string[] }).skippedLocked, [A])
  assert.equal((r as { applied: number }).applied, 0, 'applied=0，但 mcpHandler 只回这个数')

  // 目录恢复之后，AI 想把 b 重新分好 → 被锁挡住，永远进不去
  const r2 = setCategories(after, [{ skill: B, category: '影像' }], VALID)
  assert.equal(r2.ok, true)
  assert.deepEqual((r2 as { skippedLocked: string[] }).skippedLocked, [B])
  assert.equal((r2 as { next: Cfg }).next.categories![B], undefined, 'b 卡在未分类，AI 改不动')
})
