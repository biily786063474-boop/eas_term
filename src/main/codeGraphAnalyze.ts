// 代码可视化的**分析器**：扫一个项目，产出「模块 + 依赖边 + 循环 + 领地聚合」。
//
// ⚠️ **这个文件零 electron 依赖，别往里加。** IPC 注册在 `codeGraph.ts`。
// 拆开的理由和 `omp/paths.ts` 一样：`import { ipcMain } from 'electron'` 一进来，
// 这份逻辑就进不了 `node --test`，而它是整个模块里最该被测的一块
// （入口探测错了会静默少掉 90% 的代码）。
//
// **判定全在 `shared/codeGraph.ts`**（纯函数、有测试）。这个文件只做三件带副作用的事：
// 调 dependency-cruiser、读源码认类型引用、把结果交给渲染层。
//
// ── 为什么是 dependency-cruiser 而不是自己写解析 ────────────────────────────
// 见 `docs/代码可视化选型调研-2026-09-03.html`：它 MIT、有程序化 API 直接返 JSON、
// 本地分析不出站。难的从来不是「找出 import 语句」，是**解析**
//（扩展名、index 文件、tsconfig 别名、package exports）—— 那部分不该自己重写。
//
// ── 但它给不了「这条边是不是纯类型」──────────────────────────────────────
// 2026-09-03 实测：`tsPreCompilationDeps` 三种取值都不标 `type-only`，
// 开关两跑做差也没用（它压根不丢弃类型引用）。而这个区分是整个模块最有价值的一层 ——
// 用户这个仓库里 store 那 8 条「循环依赖」核过源码**全是 `import type`**，运行时不成环。
// 不分的话它们会被画成红的，而**一张全是红的图等于没有红**。
// 所以这里在 cruise 之后自己补一遍（`typeOnlyFor`，纯函数、有测试）。

import fs from 'node:fs'
import path from 'node:path'

import {
  aggregateByTerritory,
  cycleSeverity,
  deriveTerritories,
  riskByCoupling,
  territoryOf,
  typeOnlyFor,
  type CodeGraphResult,
  type GraphEdge,
  type GraphNode
} from '../shared/codeGraph.ts'

export type { CodeGraphResult }

/** 从项目根往下找入口。
 *
 *  ⚠️ **注意这里有一条被推翻的旧断言**：原来写的是「不能让它按目录扫，
 *  `depcruise src` 只抓到 34 个模块」。那是 **CLI 默认配置**的行为（不认 `.ts`/`.tsx`）。
 *  程序化调用里配了 `enhancedResolveOptions.extensions` 之后不成立 ——
 *  2026-09-03 复测本仓库：按入口 391 个、按目录扫 406 个（多出来的是没人 import 的）。
 *  所以 `entriesFromDirs` 才敢当保底那一层。
 *
 *  ⚠️ **候选表只认 .ts/.tsx 是不够的。** 2026-09-03 跑了用户 29 个项目：
 *  只有 1 个（本仓库）能扫出来。漏掉的一大类就是 `.jsx` / `.js` 入口
 *  和「主进程在 `electron/` 下」的 Electron 布局。
 *
 *  找不到任何入口时返回空数组，调用方据此如实说「这个项目我认不出入口」，
 *  **不要退回按目录扫** —— 那会给出一张看着正常、其实缺了大半的图。 */
export function findEntries(root: string): string[] {
  const candidates = [
    // Electron：主进程 / preload / 渲染 / 额外窗口
    'src/main/index.ts',
    'src/main/index.js',
    'src/preload/index.ts',
    'src/preload/index.js',
    'src/renderer/src/main.tsx',
    'src/renderer/src/main.jsx',
    'src/renderer/island/main.tsx',
    // 主进程直接放 electron/ 下的老布局（taptv 就是）
    'electron/main.ts',
    'electron/main.js',
    'electron/preload.ts',
    'electron/preload.js',
    'main.js',
    // 常见单入口。**四种扩展名都要列** —— 只列 .ts/.tsx 会整类漏掉
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'src/index.jsx',
    'src/main.ts',
    'src/main.tsx',
    'src/main.js',
    'src/main.jsx',
    'src/app.ts',
    'src/app.tsx',
    'src/app.js',
    'src/app.jsx',
    'index.ts',
    'index.js'
  ]
  return candidates.filter((c) => isFile(path.join(root, c)))
}

/** 是不是一个**文件**。`existsSync` 对目录也返回 true —— 而 `src/index.ts/`
 *  这种目录名当入口传给 dep-cruiser 会得到一张空图。 */
function isFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile()
  } catch {
    return false
  }
}

/**
 * 从 `index.html` 里挖 `<script src>`。
 *
 * **Vite 那类项目的真入口写在 HTML 里**，package.json 的 `main` 根本不指它
 * （taptv：`main` 是 `electron/main.js`，而渲染层入口是 `index.html` 里的
 * `/src/main.jsx`）—— 不看 HTML 就只能扫出主进程那 21 个模块。
 *
 * 只收**本地存在的文件**：CDN 链接和写错的路径一律丢掉，
 * 免得把一个不存在的入口塞给 dep-cruiser 换来一句 ENOENT。
 */
export function entriesFromHtml(root: string): string[] {
  const html = path.join(root, 'index.html')
  let txt: string
  try {
    txt = fs.readFileSync(html, 'utf8')
  } catch {
    return []
  }
  const out: string[] = []
  for (const m of txt.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) {
    const raw = m[1]
    if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('//')) continue // CDN
    // `/src/main.jsx` 里的前导 `/` 是**站点根**，在这儿就是项目根
    const rel = raw.replace(/^\.?\//, '').split('?')[0]
    if (isFile(path.join(root, rel))) out.push(rel)
  }
  return [...new Set(out)]
}

/** 源码扩展名。**dep-cruiser 能解析的就这些** —— `.astro` / `.vue` / `.svelte`
 *  这类框架专有格式它解析不了（实测：给 Astro 项目的 `src/pages` 得到 0 个模块），
 *  列进来只会得到一堆孤立节点，不如如实告诉用户「这个项目画不了」。 */
const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

/** 一看就不是源码的顶层目录。**只排除确定的**，拿不准的一律放行 ——
 *  漏扫一个目录是「图不全」，多扫一个只是「图上多了点东西」，前者严重得多。 */
const NOT_SOURCE = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor',
  '.git', '.next', '.nuxt', '.astro', '.cache', '.turbo', '.wrangler',
  'docs', 'doc', 'memory', 'assets', 'public', 'static', 'images', 'img',
  'ios', 'android', 'fonts', 'icons', '__pycache__'
])

/** 这个目录（含子目录，最多再往下两层）里有没有源码文件。 */
function hasSource(dir: string, depth = 2): boolean {
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of ents) {
    if (e.isFile() && SRC_EXT.has(path.extname(e.name))) return true
  }
  if (depth <= 0) return false
  for (const e of ents) {
    if (e.isDirectory() && !NOT_SOURCE.has(e.name) && !e.name.startsWith('.')) {
      if (hasSource(path.join(dir, e.name), depth - 1)) return true
    }
  }
  return false
}

/**
 * 兜底发现：把「装着源码的顶层目录」和「根目录下散着的源码文件」都当入口。
 *
 * **这是让它对任意项目都能用的那一层。** 靠约定去猜入口（`src/main.tsx` 之类）
 * 只覆盖得了自己见过的布局 —— 2026-09-03 实测用户 29 个项目只中 1 个。
 * 目录发现不依赖任何约定：仓库里有源码，它就找得到。
 *
 * ⚠️ 它和「从入口走」回答的**不是同一个问题**：入口扫给的是「从入口够得着的」，
 * 目录扫给的是「目录里有的」（含没人 import 的死代码与工具脚本）。
 * 本仓库实测：入口 391 个模块、目录扫 406 个，差的 15 个就是没人 import 的。
 * 所以结果里带 `strategy` 字段，界面上要说清用的是哪种口径。
 */
export function entriesFromDirs(root: string): string[] {
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of ents) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory()) {
      if (NOT_SOURCE.has(e.name)) continue
      if (hasSource(path.join(root, e.name))) out.push(e.name)
    } else if (e.isFile() && SRC_EXT.has(path.extname(e.name))) {
      // 根目录下散着的脚本（build.js / 服务.js 这类「一堆脚本」的项目）
      out.push(e.name)
    }
  }
  return out.sort()
}

/** 认不出入口时，最后再问一次 package.json 的 main/module。 */
function entriesFromPackageJson(root: string): string[] {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      main?: string
      module?: string
    }
    return [p.module, p.main]
      .filter((x): x is string => !!x)
      .map((x) => x.replace(/^\.?\//, ''))
      .filter((x) => isFile(path.join(root, x)))
  } catch {
    return []
  }
}

/** 源码缓存。一次扫描里同一个文件会被问很多次（它有几条出边就问几次），
 *  每次都读盘的话 371 个模块要读近千次。 */
function makeReader(root: string): (rel: string) => string | null {
  const cache = new Map<string, string | null>()
  return (rel) => {
    if (cache.has(rel)) return cache.get(rel) ?? null
    let txt: string | null = null
    try {
      txt = fs.readFileSync(path.join(root, rel), 'utf8')
    } catch {
      txt = null
    }
    cache.set(rel, txt)
    return txt
  }
}

/** 常见扩展名 → 人话。**只列常见的**；认不出的直接把扩展名报出去，
 *  别硬编一个猜的名字（"`.xyz` 项目" 比 "未知项目" 有用得多）。 */
const LANG: Record<string, string> = {
  '.py': 'Python', '.swift': 'Swift', '.cpp': 'C++', '.c': 'C', '.h': 'C/C++ 头文件',
  '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby',
  '.php': 'PHP', '.cs': 'C#', '.lua': 'Lua', '.sh': 'Shell', '.html': 'HTML',
  '.css': 'CSS', '.md': 'Markdown 文档', '.astro': 'Astro', '.vue': 'Vue', '.svelte': 'Svelte'
}

/**
 * 画不了的时候，告诉用户**这个项目里实际是什么** ——
 * 而不是一句「没找到 JS/TS 源码」让人以为是工具坏了。
 *
 * 用户 29 个项目里有 13 个走到这条路径（Swift / Python / C++ / 纯 HTML / 纯文档），
 * 它们不是失败，是这个工具的边界。说清楚边界在哪，比报个错有用。
 */
export function describeNonJs(root: string): string {
  const count = new Map<string, number>()
  const walk = (dir: string, depth: number): void => {
    if (depth < 0) return
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      // **诊断时不套 NOT_SOURCE。** 那份名单是给「找源码目录」用的，
      // 里面有 docs/ assets/ public/ —— 而画不了的项目恰恰把东西放在那儿
      //（实测「二维码」项目唯一那个 .html 就在被跳过的目录里，
      //  于是报出来的是「这个目录里没有代码文件」，等于什么也没说）。
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      if (e.isDirectory()) walk(path.join(dir, e.name), depth - 1)
      else {
        const ext = path.extname(e.name).toLowerCase()
        if (ext) count.set(ext, (count.get(ext) ?? 0) + 1)
      }
    }
  }
  walk(root, 3)
  const top = [...count.entries()]
    .filter(([e]) => e !== '.json' && e !== '.txt' && e !== '.lock')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (!top.length) return '这个目录里没有代码文件'
  const named = top.map(([e, n]) => `${LANG[e] ?? e} ${n} 个`).join('、')
  return `这个项目主要是 ${named} —— 代码地图画的是 JS/TS 模块之间的 import 关系，画不了这些`
}

export async function analyzeProject(root: string): Promise<CodeGraphResult> {
  const t0 = Date.now()
  // 四种来源**取并集，不是「前一种没有才看后一种」**：
  // Vite + Electron 的项目主进程在候选表里、渲染入口只在 index.html 里，
  // 短路的话必定漏掉半个项目（taptv 实测：只看候选表 → 21 个模块，并集 → 445 个）。
  //
  // `entriesFromDirs` 是**保底那一层**：前三种都靠约定，只覆盖得了见过的布局；
  // 目录发现不靠任何约定，仓库里有源码就找得到。
  const named = [
    ...new Set([...findEntries(root), ...entriesFromHtml(root), ...entriesFromPackageJson(root)])
  ]
  const dirs = entriesFromDirs(root)
  const entries = [...new Set([...named, ...dirs])]
  if (!entries.length) {
    throw new Error(describeNonJs(root))
  }
  // 口径：有具名入口就说「按入口 + 目录」，否则纯目录扫。界面照这个如实说明。
  const strategy: 'entries' | 'dirs' = named.length ? 'entries' : 'dirs'

  // 动态 import：dependency-cruiser 是纯 ESM，而且只有点开这个面板才需要它。
  // 静态 import 会让它在每次启动时都被加载进主进程。
  const { cruise } = await import('dependency-cruiser')
  // ⚠️ **入口必须传相对 baseDir 的路径，绝不能传绝对路径。**
  // dep-cruiser 会把绝对入口先按 `process.cwd()` 折成相对，再拿 baseDir 去 join。
  // app 的 cwd 永远不是被分析的项目，于是路径被折坏：
  //   cwd=/…/Projects/vibe coding/terminal，root=/…/Projects/taptv pad
  //   → relative 得到 "../../taptv pad/…"，join 回去变成 "/Users/biily/Biily/taptv pad/…"
  //   （少了 Projects 那一段）→ ENOENT。
  // 2026-09-03 实测：用户 29 个项目只有 1 个能扫，就是「cwd 恰好等于项目根」的那个。
  const res = await cruise(entries, {
      baseDir: root,
      doNotFollow: { path: 'node_modules' },
      exclude: { path: '(node_modules|\\.test\\.|\\.spec\\.|__fixtures__|__mocks__)' },
      // 带上类型引用（否则 `import type` 的边整个不出现）。
      // 它**不会**因此把这些边标成 type-only —— 那一步由下面自己做。
      tsPreCompilationDeps: true,
      enhancedResolveOptions: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']
      }
  })
  const out = res.output as {
    modules: {
      source: string
      dependencies: { resolved: string; module: string; circular?: boolean; couldNotResolve?: boolean }[]
    }[]
  }

  const read = makeReader(root)
  const unresolved: string[] = []
  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  const edges: GraphEdge[] = []

  // ⚠️ **裸说明符也满足「不以 node_modules 开头、不是绝对路径」** ——
  // dep-cruiser 解析不了的 `fs` / `util` / `@scope/pkg` 会原样出现在 modules 里，
  // 于是图上多出一堆磁盘上根本不存在的节点（2026-09-03 实测本仓库 16 个：
  // fs、path、crypto、net、tls…；别人的仓库里是几十上百个包名）。
  // 所以判据必须落到**磁盘上真有这个文件**，光看字符串形状拦不住。
  const localCache = new Map<string, boolean>()
  const isLocal = (p: string): boolean => {
    const hit = localCache.get(p)
    if (hit !== undefined) return hit
    const ok =
      !p.startsWith('node_modules') && !path.isAbsolute(p) && isFile(path.join(root, p))
    localCache.set(p, ok)
    return ok
  }

  for (const m of out.modules) {
    if (!isLocal(m.source)) continue
    let outN = 0
    for (const d of m.dependencies) {
      if (d.couldNotResolve) {
        unresolved.push(d.module)
        continue
      }
      if (!isLocal(d.resolved)) continue
      const src = read(m.source)
      edges.push({
        from: m.source,
        to: d.resolved,
        // `undefined` = 这份源码里找不到那个说明符（多半经别名/index 解析过来）。
        // **保留 undefined，不折成 false** —— 见 cycleSeverity 里 unknown 那一档。
        typeOnly: src ? (typeOnlyFor(src, d.module) as boolean) : (undefined as unknown as boolean),
        circular: !!d.circular
      })
      outN += 1
      inDeg.set(d.resolved, (inDeg.get(d.resolved) ?? 0) + 1)
    }
    outDeg.set(m.source, outN)
  }

  const sources = out.modules.filter((m) => isLocal(m.source)).map((m) => m.source)

  // 内置领地表是**本仓库专用**的。命中率低就说明这是别人的项目 ——
  // 那时候按目录结构现推，而不是把整个项目塞进「未登记」
  //（实测：给别人的仓库跑，3229 个模块全落进未登记，图是一坨没有结构的灰点）。
  const mappedShare = sources.length
    ? sources.filter((p) => territoryOf(p).name !== '未登记').length / sources.length
    : 0
  // **还要够多个文件才信这个比例。** 只有两三个模块的项目里，
  // 随便一个 `src/` 开头的文件就能把命中率顶到 50% 以上 ——
  // 于是一个跟本仓库毫无关系的项目被当成「命中了领地表」，图例写着「安全边界」。
  const territoryMode: 'mapped' | 'derived' =
    mappedShare >= 0.5 && sources.length >= 10 ? 'mapped' : 'derived'
  const derived = territoryMode === 'derived' ? deriveTerritories(sources) : null

  const nodes: GraphNode[] = sources.map((src) => {
    const t = derived
      ? { name: derived.get(src) ?? '根目录', risk: 'green' as const }
      : territoryOf(src)
    return {
      id: src,
      territory: t.name,
      risk: t.risk,
      inDegree: inDeg.get(src) ?? 0,
      outDegree: outDeg.get(src) ?? 0
    }
  })

  const territories = aggregateByTerritory(nodes, edges)
  if (territoryMode === 'derived') {
    // 陌生项目没有「安全边界」可言，颜色改成表达**耦合轻重**（界面上图例文案跟着换）
    riskByCoupling(territories.stats)
    const byName = new Map(territories.stats.map((t) => [t.name, t.risk]))
    for (const n of nodes) n.risk = byName.get(n.territory) ?? 'green'
  }

  return {
    root,
    nodes,
    edges,
    cycles: groupCycles(edges),
    territories,
    ms: Date.now() - t0,
    unresolved: [...new Set(unresolved)],
    strategy,
    scanned: entries,
    territoryMode
  }
}

/** 把标了 circular 的边按**连通分量**分组 —— 一个项目里可能有好几个互不相干的环，
 *  混成一坨的话「这个环是不是病」就没法分别定性了。 */
function groupCycles(
  edges: readonly GraphEdge[]
): { edges: GraphEdge[]; severity: 'runtime' | 'type' | 'unknown' }[] {
  const cyc = edges.filter((e) => e.circular)
  if (!cyc.length) return []
  // 并查集：把有共同端点的循环边并到一组
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    while (parent.get(x) !== x) {
      const p = parent.get(x)!
      parent.set(x, parent.get(p)!)
      x = parent.get(x)!
    }
    return x
  }
  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const e of cyc) union(e.from, e.to)
  const groups = new Map<string, GraphEdge[]>()
  for (const e of cyc) {
    const k = find(e.from)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups.values()]
    .map((g) => ({ edges: g, severity: cycleSeverity(g) }))
    // 运行时的环排最前 —— 它们才是要修的
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.edges.length - a.edges.length)
}

const rank = (s: 'runtime' | 'type' | 'unknown'): number =>
  s === 'runtime' ? 0 : s === 'unknown' ? 1 : 2

