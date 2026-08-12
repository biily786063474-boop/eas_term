// 库的分类配置：让用户按自己的方式组织知识库。
//
// **这个文件不许 import electron。** paths.ts 因为 cfgFile() 要 app.getPath('userData')
// 而依赖了 electron，纯 node 测试加载不了它 —— 校验逻辑放这里才测得住，
// 而这份逻辑正是「配错了会让库打不开」的地方，最需要测试。
import fs from 'fs'
import path from 'path'

/** 库根目录下的分类配置。点号开头是有意的：walkNotes 跳过点开头的条目，
 *  它不会被当成笔记扫进图谱、也不会被算成孤儿页。 */
export const TAXONOMY_FILE = '.eas-wiki.json'

export interface TaxonomyDir {
  name: string
  /** 一句话说清这里装什么。**不是注释，是要写进 agent 说明书的正文** ——
   *  这句写不清楚，agent 就不知道东西该往哪放。 */
  purpose: string
  /** inbox：收件箱（有专属机制，必须恰好一个）；templates：新建笔记的模板来源；
   *  raw：原始素材，不进索引也不算反链 */
  role?: 'inbox' | 'templates' | 'raw'
}

export interface Taxonomy {
  version: number
  dirs: TaxonomyDir[]
  frontMatter: { required: string[]; optional: string[] }
}

type Result = { ok: true; value: Taxonomy } | { ok: false; error: string }

const isStr = (v: unknown): v is string => typeof v === 'string'
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()).filter(Boolean) : []

/** 校验一份配置。**拒绝比放行安全**：配置错了顶多回落到内置分类，
 *  而放行一份缺收件箱的配置会让整理流程整条断掉，症状还很难联想到配置。 */
export function validateTaxonomy(raw: unknown): Result {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '配置不是一个对象' }
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.dirs) || o.dirs.length === 0) return { ok: false, error: 'dirs 得是非空数组' }

  const dirs: TaxonomyDir[] = []
  const seen = new Set<string>()
  for (const d of o.dirs) {
    if (!d || typeof d !== 'object') return { ok: false, error: 'dirs 里有不是对象的项' }
    const e = d as Record<string, unknown>
    const name = isStr(e.name) ? e.name.trim() : ''
    const purpose = isStr(e.purpose) ? e.purpose.trim() : ''
    if (!name) return { ok: false, error: '有目录没有 name' }
    // 这三条都会让库出问题：斜杠会建出嵌套、点开头会被 walkNotes 跳过（等于永远读不到）、
    // 撞配置文件名会互相覆盖
    if (name.includes('/') || name.includes('\\')) return { ok: false, error: `目录名不能含斜杠：${name}` }
    if (name.startsWith('.')) return { ok: false, error: `目录名不能以点开头（会被当成隐藏项跳过）：${name}` }
    if (name === TAXONOMY_FILE) return { ok: false, error: `目录名不能和配置文件同名：${name}` }
    if (seen.has(name)) return { ok: false, error: `目录名重复：${name}` }
    if (!purpose) return { ok: false, error: `「${name}」没写 purpose —— 那句话要写进 agent 说明书，空的等于没说` }
    seen.add(name)
    const role = e.role
    if (role !== undefined && role !== 'inbox' && role !== 'templates' && role !== 'raw')
      return { ok: false, error: `「${name}」的 role 不认识：${String(role)}` }
    dirs.push({ name, purpose, ...(role ? { role: role as TaxonomyDir['role'] } : {}) })
  }

  const inbox = dirs.filter((d) => d.role === 'inbox')
  if (inbox.length !== 1)
    return {
      ok: false,
      error: `必须恰好有一个 role:"inbox" 的目录（现在有 ${inbox.length} 个）—— 收件箱有专属机制（徽章计数、记录素材原来在哪），没有它整理流程会断`
    }
  if (dirs.filter((d) => d.role === 'templates').length > 1)
    return { ok: false, error: 'role:"templates" 最多一个' }

  const fmRaw = (o.frontMatter ?? {}) as Record<string, unknown>
  const required = strArr(fmRaw.required)
  if (required.length === 0) return { ok: false, error: 'frontMatter.required 不能为空' }

  return {
    ok: true,
    value: {
      version: typeof o.version === 'number' ? o.version : 1,
      dirs,
      frontMatter: { required, optional: strArr(fmRaw.optional) }
    }
  }
}

/** 读一个库的分类配置。**读不到、解析不了、校验不过，一律返回 null** ——
 *  调用方据此回落到内置八目录。不抛异常：一份手工改坏的配置不该让库打不开。 */
export function readTaxonomy(root: string): Taxonomy | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, TAXONOMY_FILE), 'utf8'))
    const r = validateTaxonomy(raw)
    if (!r.ok) {
      console.warn(`[wiki] ${TAXONOMY_FILE} 校验不过，回落到内置分类：${r.error}`)
      return null
    }
    return r.value
  } catch {
    return null
  }
}

export type LibraryDir = TaxonomyDir

/** 内置分类。**顺序和名字不许动** —— 老库的说明书按这个顺序生成，
 *  改了会让所有内置库的 CLAUDE.md 在下次启动时被重写成不同的文字。 */
export const BUILTIN_DIRS: LibraryDir[] = [
  { name: '00-inbox', purpose: '用户丢进来、还没整理的原始素材', role: 'inbox' },
  { name: 'me', purpose: '关于用户自己的：偏好、习惯、决定过的事' },
  { name: 'people', purpose: '关于别人的：合作方、同事、客户' },
  { name: 'methods', purpose: '可复用的做法与套路' },
  { name: 'domains', purpose: '某个领域的知识积累' },
  { name: 'projects', purpose: '具体项目的进展与结论' },
  { name: 'sources', purpose: '原始出处：论文、文章、录音的存档', role: 'raw' },
  { name: '_templates', purpose: '新建笔记的模板', role: 'templates' }
]

/** 这个库实际长什么样。有 .eas-wiki.json 就按它，没有就是内置八目录。
 *
 *  `resolve` 由调用方注入而不是在这里 import dirOf —— 那会把 electron 依赖
 *  拖进这个文件（paths.ts 引了 electron），测试就加载不了了。
 *  内置路径需要它做老库中文名回落；自定义路径不需要，名字就是配置里写的。 */
export function libraryDirs(root: string, resolve: (key: string) => string): LibraryDir[] {
  const t = readTaxonomy(root)
  if (t) return t.dirs
  return BUILTIN_DIRS.map((d) => ({ ...d, name: resolve(d.name) }))
}
