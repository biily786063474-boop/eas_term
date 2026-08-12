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

/** 一个库的分类配置到底是什么状态。**三态，不是「有/null」两态**——
 *  `readTaxonomy` 把「没有配置」和「配置在但读不出来」压成了同一个 null，
 *  调用方（比如 initWiki）没法区分「这本来就是内置库」和「这本来是自定义库，
 *  配置刚好被写坏了」。两者该有的处理天差地别：前者照今天的样子回落内置八目录；
 *  后者**什么都不能做**——回落会把这个自定义库真的改写成内置形状（在库里建出
 *  me/、people/ 这些配置外的目录，说明书换成内置正文），不可逆。用户改好配置
 *  本该能救回来，一旦被回落覆盖过，改好配置也救不回来了。 */
export type TaxonomyState =
  | { kind: 'none' }
  | { kind: 'valid'; value: Taxonomy }
  | { kind: 'broken'; error: string }

/** 三态判定。**没有文件**（真没配过库、或者库目录本身还不存在）→ `'none'`；
 *  **文件在但读不出来**（权限问题、其实是个目录）、**不是合法 JSON**、或
 *  **校验不过**——这三种成因对用户来说都是「配置坏了」，统一归为 `'broken'`，
 *  `error` 给出人能看懂的原因（校验失败复用 validateTaxonomy 的错误文案）。 */
export function taxonomyState(root: string): TaxonomyState {
  let raw: string
  try {
    raw = fs.readFileSync(path.join(root, TAXONOMY_FILE), 'utf8')
  } catch (err) {
    const e = err as (Error & { code?: string }) | null
    if (e?.code === 'ENOENT') return { kind: 'none' }
    // 文件在但读不出来（权限、其实是个目录…）——不是「没配过」，是「配坏了」，
    // 不能当成 'none' 回落，否则会往这个自定义库里撒内置目录。
    return { kind: 'broken', error: `${TAXONOMY_FILE} 读不出来：${e instanceof Error ? e.message : String(e)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      kind: 'broken',
      error: `${TAXONOMY_FILE} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`
    }
  }
  const r = validateTaxonomy(parsed)
  if (!r.ok) return { kind: 'broken', error: r.error }
  return { kind: 'valid', value: r.value }
}

/** 读一个库的分类配置。**签名保持不变**（很多调用点依赖 `Taxonomy | null`，
 *  这些调用点全都只关心「有没有能用的配置」，不关心三态的区别）——
 *  没有配置、或配置坏了，一律返回 null，调用方据此回落到内置八目录。
 *
 *  **这条回落只对「没有配置」成立**；「配置坏了」不该走同一条回落路径
 *  （见上面 taxonomyState 的注释），需要区分这两种情况的调用方（目前是
 *  initWiki）改去直接调 `taxonomyState`，不能再靠这个函数的返回值猜。 */
export function readTaxonomy(root: string): Taxonomy | null {
  const s = taxonomyState(root)
  if (s.kind === 'broken') console.warn(`[wiki] ${TAXONOMY_FILE} 读不出来，回落到内置分类：${s.error}`)
  return s.kind === 'valid' ? s.value : null
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

/** 内置库两个原始素材区的老库中文名。与 paths.ts 的 LEGACY 表对应，
 *  这里单列是因为 taxonomy.ts 不能 import paths.ts（那边引了 electron）。
 *  只在内置分支生效 —— 自定义库的原始素材区叫什么完全由配置的 role 决定。 */
const BUILTIN_RAW_ALIASES = ['00-收件箱', '素材']

/** 这个名字算不算「原始素材区」（不是笔记，不进索引也不算反链）。
 *
 *  有配置只认配置里的 role；没配置走内置八目录里 role 是 inbox/raw 的那些，
 *  外加老库中文别名 —— 否则一个中文老库如果同时有 00-收件箱 和 00-inbox 两个目录，
 *  `resolve`（即 dirOf）会因为 00-inbox 已存在而只回落出 00-inbox 一个名字，
 *  00-收件箱 就会从「被跳过」变成「被当成笔记扫进图谱」。别名表补的就是这个洞。
 *
 *  `resolve` 同 libraryDirs：由调用方注入，避免这个文件 import ./paths。 */
export function isRawName(root: string, rel: string, resolve: (key: string) => string): boolean {
  const t = readTaxonomy(root)
  if (t) return t.dirs.some((d) => d.name === rel && (d.role === 'inbox' || d.role === 'raw'))
  if (BUILTIN_RAW_ALIASES.includes(rel)) return true
  return BUILTIN_DIRS.some((d) => (d.role === 'inbox' || d.role === 'raw') && resolve(d.name) === rel)
}

export type ArchiveDirResult = { ok: true; name: string } | { ok: false; error: string }

/** 归档（wiki:archive）该把文件搬去哪个目录：自定义库取配置里**第一个** role:"raw" 的
 *  目录名；没配置就是内置库的 sources（老库中文名回落交给 resolve 处理，和 libraryDirs/
 *  isRawName 同一套注入方式，避免这个文件 import ./paths）。
 *
 *  **这里必须能失败，是和 inboxOf/libraryDirs 最大的不同**——而且能失败的原因有两种，
 *  必须分开判断，不能都走 libraryDirs 的回落：
 *
 *  1. **配置读不出来（`taxonomyState` 是 broken）**：这时候绝不能落到 libraryDirs 的
 *     内置回落——那会把归档目标解析成内置的 `sources`，在**这个自定义库**里凭空建出
 *     一个配置外的 `sources/`。这正是 Critical 1 的病根从「配置坏掉」这条路流回来：
 *     旧代码在 wiki:archive 里固定拼 `dirOf(root, 'sources')`，新代码如果对 broken
 *     态也回落等于犯同一个错——`sources/` 不在 isRawName 的判定范围内（它只认配置里
 *     声明的名字），归档进去的原件会被 walkNotes 当成笔记扫进图谱和体检。
 *  2. **配置合法但没有任何 role:"raw" 目录**：raw 目录在自定义库里是可选的——用户
 *     完全可能没有「素材/附件」这类只存档不写笔记的东西。这种情况下也不能凭空造目录，
 *     但原因和第 1 种不同（配置没问题，只是这个库真的没声明 raw 目录），错误文案要
 *     分开写清楚——用户看到第 1 种该去修 JSON 格式，看到第 2 种该去配置里加一个
 *     `role:"raw"`，是两件不同的事，混在一句话里用户不知道该做哪个。
 *
 *  调用方（index.ts 的 wiki:archive handler）必须检查 ok，false 时直接报错给用户，
 *  不能自己兜底出一个目录名。
 *
 *  paths.ts 的 archiveDirOf 是这个函数的一行转发（注入 dirOf 当 resolve），拆开是因为
 *  paths.ts 引了 electron，node --test 加载不了它——判定逻辑放这里才测得住。 */
export function rawDirOf(root: string, resolve: (key: string) => string): ArchiveDirResult {
  const state = taxonomyState(root)
  if (state.kind === 'broken')
    return {
      ok: false,
      error:
        `这个知识库的分类配置读不出来（${state.error}），归档先停一下——` +
        '回落到内置分类会把文件搬进这个自定义库里一个配置外的目录，先去把 .eas-wiki.json 改好再归档。'
    }
  const raw = libraryDirs(root, resolve).find((d) => d.role === 'raw')
  if (!raw)
    return {
      ok: false,
      error:
        '这个知识库的分类配置里没有 role:"raw" 的目录，归档没有落点——' +
        '去 .eas-wiki.json 里把某个目录标成 "role": "raw"，或者新建一个。'
    }
  return { ok: true, name: raw.name }
}
