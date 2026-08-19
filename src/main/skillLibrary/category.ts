// 分类：读取端（配置 → 面板分组）+ 写入端（agent 提交的一批分类 → 配置）。
//
// 数据形状：一份 `Record<skillPath, categoryName>`，存在 app 自己的配置里
// （跟自定义目录、禁用清单同一处，见 skillLibrary/index.ts 的 cfgFile）。
// **分类结果不写进用户的 skill 目录**——跟「禁用不动文件」同一个理由。
//
// 「扁平一层，不可嵌套」「没有分类时全部归到未分类」是用户已经拍板的两条
// （design 文档 §六 第 3 条），下面的分组逻辑照这两条实现。
//
// 读写两端的校验强度**故意不一样**，别把它们合成一个函数：
//   - 读取端（sanitizeCategoryAssignment）丢弃单条脏数据、保住其余——处理的是已经落盘
//     之后磁盘状态可能已经变化的配置（skill 目录后来被删了之类）。
//   - 写入端（validateCategoryBatch）**一条不合格就拒绝整批**——这是 agent 正在提交的请求，
//     错了就该当场打回去让它改（design 文档 §四：「agent 报了一个不存在的 skill，
//     要拒绝整批而不是静默丢弃」）。静默丢弃的后果是 agent 以为自己整理完了、用户看到的
//     分类却缺几条，而且没有任何人会发现。
//
// 不引 electron/fs：输入是已经读出来的 JSON 值和一份「当前有效 skill 路径」的集合，
// node --test 直接测。

import type { SkillCategoryGroup, SkillInfo } from '../../shared/types'

// **带扩展名**：这个文件要能被 `node --test` 直接跑（值 import 少了 .ts 解析不到，
// 见 tidyOrder.ts 立的规矩）。类型 import 无所谓，值 import 必须带。
export { UNCATEGORIZED } from '../../shared/types.ts'
import { UNCATEGORIZED } from '../../shared/types.ts'

/** 分类名的长度上限（design 文档 §四：「分类名是字符串、非空、有长度上限」）。
 *  写入端（第二半 MCP 工具）校验用同一个常量，这里额外拿它做读取时的防御性过滤——
 *  正常不会触发，只防配置文件被手改成异常内容。 */
export const CATEGORY_NAME_MAX = 40

export type CategoryAssignment = Record<string, string>

/**
 * 校验 + 过滤一份原始分类配置（读盘拿到的 `unknown`）。
 *
 * **丢弃单条脏数据，不作废整份配置**——这是读取端的降级策略，跟写入端「引用了不存在
 * 的 skill 就拒绝整批」是两回事（那是 MCP 工具校验请求时的规则，写的时候就该挡住；
 * 这里处理的是已经落盘之后、磁盘状态可能已经变化的配置——比如 skill 目录后来被删了，
 * 配置里还留着一条指向它的分类。不能因为这一条脏，就让同一份配置里其余几十条分类全部失效）。
 *
 * 丢弃条件：不是字符串值 / 修剪后为空 / 超长 / 引用的 skill 路径当前不存在。
 */
export function sanitizeCategoryAssignment(raw: unknown, validSkillPaths: ReadonlySet<string>): CategoryAssignment {
  const out: CategoryAssignment = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [skillPath, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name || name.length > CATEGORY_NAME_MAX) continue
    if (!validSkillPaths.has(skillPath)) continue
    out[skillPath] = name
  }
  return out
}

/**
 * 按分类分组。未分类固定排最后一组——不管它是不是最大的一组，用户更想先看到
 * 「已经被整理过」的部分，未分类那堆本来就是待处理的，排前面反而抢眼。
 * 已命名分类之间按名称排序，保证同一份数据每次分组结果的组顺序都一样（不依赖
 * Map 的插入序，插入序取决于 skills 数组顺序，容易在不同调用间意外变化）。
 */
export function groupByCategory(
  skills: readonly SkillInfo[],
  assignment: CategoryAssignment,
  /** 用户自建的分类名。**空分类也要出现** —— 新建一个分类后它得先显示出来、
   *  能当拖拽的落点，用户才有地方把 skill 拖进去。不传就只按成员分组（老行为）。 */
  extraNames: readonly string[] = []
): SkillCategoryGroup[] {
  const buckets = new Map<string, string[]>()
  for (const n of extraNames) {
    const t = n.trim()
    if (t && t !== UNCATEGORIZED) buckets.set(t, [])
  }
  for (const sk of skills) {
    const cat = assignment[sk.path]?.trim() || UNCATEGORIZED
    const list = buckets.get(cat)
    if (list) list.push(sk.path)
    else buckets.set(cat, [sk.path])
  }
  const names = [...buckets.keys()].filter((n) => n !== UNCATEGORIZED).sort((a, b) => a.localeCompare(b, 'zh'))
  if (buckets.has(UNCATEGORIZED)) names.push(UNCATEGORIZED)
  return names.map((name) => ({ name, skillPaths: buckets.get(name)! }))
}

// ── 写入端：agent 通过 MCP 提交的一批分类 ────────────────────────────────

/** 一批最多能改多少条。不是性能考虑——是「一次调用不该重排整台机器上所有 skill」这个
 *  语义边界，也顺带挡住误传进来的巨大数组。用户机器上全部 skill 加起来 50 个上下。 */
export const CATEGORY_BATCH_MAX = 300

export type CategoryBatchResult =
  | { ok: true; assignment: CategoryAssignment }
  | { ok: false; error: string }

/**
 * 校验 agent 提交的一批分类。**任何一条不合格 → 拒绝整批**，error 里点名是哪几条、错在哪
 * （agent 只有拿到具体的名字才改得动；笼统一句「参数不对」它只会原样重试）。
 *
 * 规则：
 * - 必须是非空数组，长度不超过 CATEGORY_BATCH_MAX
 * - 每条是 `{ skill: 绝对路径, category: 非空字符串 }`
 * - 分类名 trim 后非空、不超过 CATEGORY_NAME_MAX、不含换行（一行显示在可折叠的分类头上）
 * - 分类名不能是 UNCATEGORIZED 那个显示用的名字——「未分类」是「没有分类」的呈现，
 *   不是一个可以主动分进去的类；允许写进配置会造出两条含义相同但来源不同的路径
 * - skill 必须真实存在（在 validSkillPaths 里）
 * - **一个 skill 只能属于一个分类**（design 文档 §六 第 3 条的直接推论）：
 *   同一批里同一个 skill 出现两次且分类不同 → 拒绝整批
 */
export function validateCategoryBatch(raw: unknown, validSkillPaths: ReadonlySet<string>): CategoryBatchResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'assignments 必须是数组' }
  if (raw.length === 0) return { ok: false, error: 'assignments 是空的，没有要写的东西' }
  if (raw.length > CATEGORY_BATCH_MAX) {
    return { ok: false, error: `一次最多 ${CATEGORY_BATCH_MAX} 条，这批有 ${raw.length} 条` }
  }

  const assignment: CategoryAssignment = {}
  const badShape: number[] = []
  const badName: string[] = []
  const unknown: string[] = []
  const conflict: string[] = []

  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      badShape.push(i)
      return
    }
    const { skill, category } = item as { skill?: unknown; category?: unknown }
    if (typeof skill !== 'string' || !skill.trim() || typeof category !== 'string') {
      badShape.push(i)
      return
    }
    const p = skill.trim()
    const name = category.trim()
    if (!name || name.length > CATEGORY_NAME_MAX || /[\r\n\t]/.test(name) || name === UNCATEGORIZED) {
      badName.push(`${p} → 「${category}」`)
      return
    }
    if (!validSkillPaths.has(p)) {
      unknown.push(p)
      return
    }
    if (assignment[p] !== undefined && assignment[p] !== name) {
      conflict.push(p)
      return
    }
    assignment[p] = name
  })

  if (badShape.length) {
    return { ok: false, error: `第 ${badShape.map((i) => i + 1).join('、')} 条格式不对：每条要有 skill(绝对路径) 和 category(字符串)` }
  }
  if (badName.length) {
    return {
      ok: false,
      error:
        `这几条的分类名不合规（要非空、不超过 ${CATEGORY_NAME_MAX} 个字、不能换行、` +
        `不能叫「${UNCATEGORIZED}」——那是没分类时的默认显示）：${badName.join('；')}`
    }
  }
  if (unknown.length) {
    return {
      ok: false,
      error:
        `这几个 skill 不存在，整批都没写：${unknown.join('、')}。` +
        `skill 的 id 是它的目录绝对路径，先用 skill_list 拿准确的路径再提交。`
    }
  }
  if (conflict.length) {
    return { ok: false, error: `同一个 skill 在这批里被分到了两个不同的分类（一个 skill 只能属于一个分类）：${conflict.join('、')}` }
  }
  return { ok: true, assignment }
}

/** 用户在面板里手动拖过的 skill —— **AI 不许覆盖它们**（用户 2026-08-18 拍板）。
 *  存的是 skill 绝对路径。手动分类和 AI 分类共用 `categories` 那一份数据，
 *  这里只多记一句「这条是人定的」。
 *
 *  为什么不给分类名加前缀之类的标记：那会污染分类名本身（显示、去重、改名全要
 *  绕开那个前缀），而「谁定的」是这条记录的元信息，不是分类名的一部分。 */
export function sanitizeLocks(raw: unknown, validSkillPaths: ReadonlySet<string>): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    // 同读取端的降级策略：单条脏数据丢掉，不作废整份（skill 后来被删了就属于这种）
    if (typeof v === 'string' && validSkillPaths.has(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/** 从一批 AI 提交的分类里，剔掉被用户手动锁住的那些。
 *  返回**过滤后的批次**和被跳过的路径 —— 跳过的要告诉 agent，否则它以为自己
 *  整理完了，而用户看到的分类没变，双方都不知道发生了什么。 */
export function dropLocked(
  assignment: CategoryAssignment,
  locks: readonly string[]
): { kept: CategoryAssignment; skipped: string[] } {
  const lockSet = new Set(locks)
  const kept: CategoryAssignment = {}
  const skipped: string[] = []
  for (const [p, name] of Object.entries(assignment)) {
    if (lockSet.has(p)) skipped.push(p)
    else kept[p] = name
  }
  return { kept, skipped }
}

/** 用户自建的分类名清单（含还没有任何 skill 的空分类）。
 *  没有它的话，「新建分类」建完就消失了 —— groupByCategory 只认有成员的分类。 */
export function sanitizeCategoryNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const n = v.trim()
    if (!n || n.length > CATEGORY_NAME_MAX || n === UNCATEGORIZED) continue
    if (!out.includes(n)) out.push(n)
  }
  return out
}
