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
  territoryOf,
  typeOnlyFor,
  type CodeGraphResult,
  type GraphEdge,
  type GraphNode
} from '../shared/codeGraph.ts'

export type { CodeGraphResult }

/** 从项目根往下找入口。
 *
 *  ⚠️ **必须给入口，不能让它按目录扫。** 2026-09-03 实测：
 *  `depcruise src` 只抓到 34 个模块（按目录扫时它默认不认 `.ts`/`.tsx`），
 *  而且**不报任何错**；给四个真实入口之后是 371 个。
 *  这条如果没实测，配出来的图会少掉 90% 的代码而看不出任何异常。
 *
 *  找不到任何入口时返回空数组，调用方据此如实说「这个项目我认不出入口」，
 *  **不要退回按目录扫** —— 那会给出一张看着正常、其实缺了大半的图。 */
export function findEntries(root: string): string[] {
  const candidates = [
    // Electron 三件套（本项目的形状）
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/renderer/src/main.tsx',
    'src/renderer/island/main.tsx',
    // 常见单入口
    'src/index.ts',
    'src/index.tsx',
    'src/main.ts',
    'src/main.tsx',
    'src/app.ts',
    'index.ts',
    'index.js'
  ]
  return candidates.filter((c) => fs.existsSync(path.join(root, c)))
}

/** 认不出入口时，最后再问一次 package.json 的 main/module/exports。 */
function entriesFromPackageJson(root: string): string[] {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      main?: string
      module?: string
    }
    return [p.module, p.main].filter((x): x is string => !!x && fs.existsSync(path.join(root, x)))
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

export async function analyzeProject(root: string): Promise<CodeGraphResult> {
  const t0 = Date.now()
  const entries = findEntries(root).length ? findEntries(root) : entriesFromPackageJson(root)
  if (!entries.length) {
    throw new Error('认不出这个项目的入口文件 —— 暂时只支持 src/ 下的常见布局')
  }

  // 动态 import：dependency-cruiser 是纯 ESM，而且只有点开这个面板才需要它。
  // 静态 import 会让它在每次启动时都被加载进主进程。
  const { cruise } = await import('dependency-cruiser')
  const res = await cruise(
    entries.map((e) => path.join(root, e)),
    {
      baseDir: root,
      doNotFollow: { path: 'node_modules' },
      exclude: { path: '(node_modules|\\.test\\.|\\.spec\\.|__fixtures__|__mocks__)' },
      // 带上类型引用（否则 `import type` 的边整个不出现）。
      // 它**不会**因此把这些边标成 type-only —— 那一步由下面自己做。
      tsPreCompilationDeps: true,
      enhancedResolveOptions: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']
      }
    }
  )
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

  const isLocal = (p: string): boolean => !p.startsWith('node_modules') && !path.isAbsolute(p)

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

  const nodes: GraphNode[] = out.modules
    .filter((m) => isLocal(m.source))
    .map((m) => {
      const t = territoryOf(m.source)
      return {
        id: m.source,
        territory: t.name,
        risk: t.risk,
        inDegree: inDeg.get(m.source) ?? 0,
        outDegree: outDeg.get(m.source) ?? 0
      }
    })

  return {
    root,
    nodes,
    edges,
    cycles: groupCycles(edges),
    territories: aggregateByTerritory(nodes, edges),
    ms: Date.now() - t0,
    unresolved: [...new Set(unresolved)]
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

