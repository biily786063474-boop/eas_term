// 代码可视化模块的**纯判定层**：领地归属、风险等级、类型引用识别、按领地聚合。
//
// 抽在 shared 而不是主进程里，理由和 `ompSetup.ts` 一样：这一层全是判断，
// 而判断错了的表现很隐蔽（图看着正常、只是把某块地画错了颜色），必须能单测。
// 这里**零依赖**（不 import electron / fs / dependency-cruiser），`node --test` 直接跑。

/** 图纸 10 的风险等级。含义逐字照抄那份文件的表头，别在这里另立解释。 */
export type Risk = 'green' | 'amber' | 'red' | 'frozen'

export interface GraphNode {
  /** 相对项目根的路径，如 `src/main/index.ts` */
  id: string
  /** 归属领地（`territoryOf` 给的 key） */
  territory: string
  risk: Risk
  /** 被多少个模块依赖（扇入） */
  inDegree: number
  /** 自己依赖多少个（扇出） */
  outDegree: number
  /** 这个节点代表几个文件。**默认 1（就是它自己）。**
   *
   *  只有**模块级**的节点会填别的值：Swift 的一个 target 是一个节点，
   *  但装着好几个 `.swift`。不填的话卡片上每个 target 都写「1 个文件」，
   *  图上的点也一样大 —— 而大小本该表达规模（2026-09-03 真机看出来的）。 */
  weight?: number
}

export interface GraphEdge {
  from: string
  to: string
  /** **纯类型引用**（整条 import 都是 `import type` / `import { type … }`）。
   *  它编译后不存在，运行时不成环 —— 循环依赖的定性完全靠这一位。 */
  typeOnly: boolean
  /** 这条边参与循环依赖 */
  circular: boolean
}

// ── 领地划分 ────────────────────────────────────────────────────────────────
//
// **这张表是 `docs/architecture/10-模块领地图.md` 的机器可读镜像。**
// 那份文件是权威，这里是镜像 —— `codeGraph.test.ts` 里有一条测试去读那份 markdown、
// 核对每块地都在这儿登记过，所以它不会悄悄漂移。
//
// ⚠️ **顺序有意义**：从上往下第一个前缀匹配的胜出。所以更具体的路径必须排在前面
// （`src/main/agentChat/omp` 要排在 `src/main/agentChat` 前面）。
// 把顺序打乱的表现是「某块地整个消失、被并进了它的父目录」。

interface TerritoryRule {
  prefix: string
  name: string
  risk: Risk
}

const TERRITORIES: TerritoryRule[] = [
  // —— 外围：分发产物与构建输出，不许手改 ——
  { prefix: 'out/', name: '构建输出', risk: 'frozen' },
  { prefix: 'site/vendor/', name: '分发产物', risk: 'frozen' },

  // —— 契约层与跨进程边界 ——
  { prefix: 'src/shared/', name: '契约层', risk: 'red' },
  { prefix: 'src/preload/', name: 'preload', risk: 'red' },
  { prefix: 'src/tunnel/', name: '隧道', risk: 'red' },
  { prefix: 'mcp/', name: 'MCP 协议', risk: 'red' },

  // —— 主进程（更具体的排前面）——
  { prefix: 'src/main/agentChat/omp/', name: 'omp 底座', risk: 'amber' },
  { prefix: 'src/main/agentChat/', name: 'AI 会话', risk: 'amber' },
  { prefix: 'src/main/cliAuth/', name: 'CLI 装登', risk: 'amber' },
  { prefix: 'src/main/phone/', name: '手机端', risk: 'amber' },
  { prefix: 'src/main/skillLibrary/', name: 'skill 库', risk: 'amber' },
  { prefix: 'src/main/wiki/', name: '知识库', risk: 'amber' },
  { prefix: 'src/main/', name: '主进程', risk: 'red' },

  // —— 渲染层 ——
  { prefix: 'src/renderer/src/store/', name: 'store', risk: 'red' },
  { prefix: 'src/renderer/island/', name: '灵动岛', risk: 'green' },
  { prefix: 'src/renderer/src/features/canvas/', name: '画布', risk: 'amber' },
  { prefix: 'src/renderer/src/features/design/', name: '设计模块', risk: 'amber' },
  { prefix: 'src/renderer/src/features/workspace/', name: '工作区', risk: 'amber' },
  { prefix: 'src/renderer/src/features/terminal/', name: '终端', risk: 'amber' },
  { prefix: 'src/renderer/src/features/status/', name: '状态机', risk: 'amber' },
  { prefix: 'src/renderer/src/features/git/', name: 'Git', risk: 'amber' },
  { prefix: 'src/renderer/src/features/agentChat/', name: 'AI 对话', risk: 'green' },
  { prefix: 'src/renderer/src/features/', name: '其余 feature', risk: 'green' },
  { prefix: 'src/renderer/src/ui/', name: 'UI 原子', risk: 'green' },
  { prefix: 'src/renderer/src/', name: '渲染层其余', risk: 'green' }
]

/** 这个文件属于哪块地。认不出的一律归「未登记」——
 *  **不猜、不按目录名瞎编**：一块没登记的地出现在图上，本身就是要人去补图纸的信号。 */
export function territoryOf(path: string): { name: string; risk: Risk } {
  const hit = TERRITORIES.find((t) => path.startsWith(t.prefix))
  return hit ? { name: hit.name, risk: hit.risk } : { name: '未登记', risk: 'green' }
}

/** 登记在案的领地名（给界面做图例用）。 */
export function territoryNames(): string[] {
  return [...new Set(TERRITORIES.map((t) => t.name))]
}

// ── 纯类型引用识别 ──────────────────────────────────────────────────────────
//
// **为什么要自己写**：dependency-cruiser 18 不区分 `import type`
// （实测：`store/types.ts` 里四条全是 `import type`，它照样报成普通 import，
// 开不开 `tsPreCompilationDeps` 结果一样）。而这个区分是整个模块最有价值的一层 ——
// 不分的话 store 那八条类型循环会被画成红的，**而一张全是红的图等于没有红**。

/** 一条 import 语句是不是**纯类型**。
 *
 *  认这几种：
 *    `import type X from 's'` · `import type { A } from 's'`
 *    `import { type A, type B } from 's'`（每一项都带 type）
 *    `export type { X } from 's'`
 *  不认（是值引用）：
 *    `import { type A, B } from 's'`（混着，B 是值）
 *    `import X from 's'` · `import 's'`（副作用导入）
 */
export function isTypeOnlyStatement(stmt: string): boolean {
  const s = stmt.trim()
  // `import type …` / `export type …`：整条都是类型
  if (/^(?:import|export)\s+type\b/.test(s)) return true
  // 具名列表：取花括号里的内容逐项判
  const m = s.match(/^(?:import|export)\s*\{([^}]*)\}/)
  if (!m) return false
  const items = m[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  // 空花括号 `import {} from 's'` 当值引用（它仍会执行模块副作用）
  if (!items.length) return false
  return items.every((x) => /^type\s+/.test(x))
}

/**
 * 从一份源码里判断「对某个模块说明符的引用是不是纯类型」。
 *
 * **只要有一条是值引用就算值引用** —— 一个文件可以对同一个模块又 import type 又 import 值，
 * 那种情况下运行时的边是真实存在的。
 *
 * @param source    引用方的源码全文
 * @param specifier import 语句里写的那个字符串（如 `./types` / `../../shared/types`）
 * @returns `true` = 纯类型；`false` = 有值引用；`undefined` = **这份源码里没找到这个说明符**
 *          （多半是它经别名/index 解析过来的，判不了 —— 判不了就别猜）
 */
export function typeOnlyFor(source: string, specifier: string): boolean | undefined {
  // 把 specifier 里的正则元字符转义
  const esc = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 匹配整条 import/export 语句（到 from '<spec>' 为止）
  const re = new RegExp(`(?:^|\\n)\\s*((?:import|export)[\\s\\S]*?from\\s*['"]${esc}['"])`, 'g')
  const found: string[] = []
  for (let m = re.exec(source); m; m = re.exec(source)) found.push(m[1])
  // 顺带认一下副作用导入 `import 's'`：它没有 from，是值引用
  if (new RegExp(`(?:^|\\n)\\s*import\\s*['"]${esc}['"]`).test(source)) return false
  if (!found.length) return undefined
  return found.every(isTypeOnlyStatement)
}

// ── 循环依赖定性 ────────────────────────────────────────────────────────────

/** 一组循环边的严重度。
 *
 *  · `runtime` —— 里面有值引用，**运行时真的成环**，是要修的；
 *  · `type`    —— 全是纯类型引用，编译后不存在，**不是病**（store 那组就是）；
 *  · `unknown` —— 判不出来（源码里找不到那个说明符）。**不许当成 type 放过** ——
 *                 「判不出来」和「确认无害」是两件事，混了就是在骗自己。 */
export function cycleSeverity(edges: readonly GraphEdge[]): 'runtime' | 'type' | 'unknown' {
  if (!edges.length) return 'type'
  if (edges.some((e) => e.typeOnly === false)) return 'runtime'
  return edges.every((e) => e.typeOnly === true) ? 'type' : 'unknown'
}

// ── 按领地聚合 ──────────────────────────────────────────────────────────────

export interface TerritoryStat {
  name: string
  risk: Risk
  files: number
  /** 出边指向**别的领地**的条数 —— 跨界耦合，这个数字才是「耦合状态」的主指标 */
  crossOut: number
  /** 入边来自**别的领地**的条数 */
  crossIn: number
}

/**
 * 把文件级的图聚合成领地级。
 *
 * **默认视图必须是领地级，不是文件级。** 371 个节点画出来是一团毛线，
 * 而人真正想知道的是「哪块地在跨界拉扯」。文件级留给下钻。
 */
export function aggregateByTerritory(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): { stats: TerritoryStat[]; links: { from: string; to: string; count: number }[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const stats = new Map<string, TerritoryStat>()
  for (const n of nodes) {
    const s = stats.get(n.territory) ?? {
      name: n.territory,
      risk: n.risk,
      files: 0,
      crossOut: 0,
      crossIn: 0
    }
    s.files += n.weight ?? 1
    // 同一块地里风险等级理论上一致；万一不一致取更严的那个（宁可标红）
    if (RISK_ORDER[n.risk] > RISK_ORDER[s.risk]) s.risk = n.risk
    stats.set(n.territory, s)
  }
  const links = new Map<string, { from: string; to: string; count: number }>()
  for (const e of edges) {
    const a = byId.get(e.from)?.territory
    const b = byId.get(e.to)?.territory
    if (!a || !b || a === b) continue // 领地内部的边不算跨界
    const k = `${a}→${b}`
    const l = links.get(k) ?? { from: a, to: b, count: 0 }
    l.count += 1
    links.set(k, l)
    const sa = stats.get(a)
    const sb = stats.get(b)
    if (sa) sa.crossOut += 1
    if (sb) sb.crossIn += 1
  }
  return {
    stats: [...stats.values()].sort((x, y) => y.files - x.files),
    links: [...links.values()].sort((x, y) => y.count - x.count)
  }
}

const RISK_ORDER: Record<Risk, number> = { green: 0, amber: 1, red: 2, frozen: 3 }

// ── 陌生项目：按目录结构现推领地 ────────────────────────────────────────────
//
// 上面那张 TERRITORIES 表是**本仓库专用**的（它编码的是图纸 10 里的真实知识：
// 哪块是禁区、哪块高耦合）。换个项目它一条也命中不了 ——
// 2026-09-03 实测：给别人的仓库跑，3229 个模块**全部落进「未登记」**，
// 图就是一坨没有结构的灰点。
//
// 所以陌生项目退回「按目录分组」：不假装懂它的架构，只如实把目录结构画出来。

/** 分组数的上限。超过这么多，环形图上的标签就开始互相压，读不出东西。 */
const MAX_GROUPS = 24
/** 一段占比超过这个值就往下再拆一层 —— 否则「src 一个节点装 90% 的文件」，
 *  图上什么也看不出来。 */
const SPLIT_AT = 0.5

/**
 * 按目录结构推领地：路径 → 领地名。
 *
 * 先按第一段分；某一段占比过半时，把**那一段**单独再往下拆一层
 *（只拆它，不是全体加深 —— 全体加深会把本来就均匀的那些也炸成一堆碎片）。
 */
export function deriveTerritories(paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!paths.length) return out

  const seg = (p: string, n: number): string => {
    const parts = p.split('/').filter(Boolean)
    // **最后一段是文件名，不是目录** —— 夹在目录段数以内。
    // 不夹的话 `src/a.ts` 会被拆成领地「src/a.ts」，每个文件自成一块地。
    const dirs = parts.length - 1
    const take = Math.min(n, dirs)
    // 根目录下的文件没有目录段 —— 给个名字，不能是空串
    if (take <= 0) return '根目录'
    return parts.slice(0, take).join('/')
  }

  const count = (n: number, only?: string): Map<string, number> => {
    const c = new Map<string, number>()
    for (const p of paths) {
      if (only !== undefined && seg(p, n - 1) !== only) continue
      const k = seg(p, n)
      c.set(k, (c.get(k) ?? 0) + 1)
    }
    return c
  }

  const top = count(1)
  // 哪些一级目录大到该再拆一层
  const split = new Set<string>()
  for (const [k, v] of top) {
    if (k === '根目录') continue
    if (v / paths.length > SPLIT_AT && count(2, k).size > 1) split.add(k)
  }

  for (const p of paths) {
    const one = seg(p, 1)
    out.set(p, split.has(one) ? seg(p, 2) : one)
  }

  // 组太多就退回一级目录；还是太多就把小的并成「其它」
  if (new Set(out.values()).size > MAX_GROUPS) {
    for (const p of paths) out.set(p, seg(p, 1))
  }
  if (new Set(out.values()).size > MAX_GROUPS) {
    const c = new Map<string, number>()
    for (const v of out.values()) c.set(v, (c.get(v) ?? 0) + 1)
    const keep = new Set(
      [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_GROUPS - 1).map(([k]) => k)
    )
    for (const [p, v] of out) if (!keep.has(v)) out.set(p, '其它')
  }
  return out
}

/**
 * 陌生项目没有「风险等级」可言 —— 我们对它的架构一无所知，
 * 硬套「安全边界 / 禁区」是**编造**。
 * 但颜色这一维不该浪费，所以改成表达**耦合轻重**（跨界边越多越红）。
 * 界面上的图例文案要跟着换，不能还写「安全边界」。
 *
 * 就地改写传入的 stats。
 */
export function riskByCoupling(stats: TerritoryStat[]): void {
  // 只有一块地时没有可比对象，全绿 —— 标红等于在说「它比谁都重」，而根本没有谁
  if (stats.length < 2) {
    for (const s of stats) s.risk = 'green'
    return
  }
  const score = (s: TerritoryStat): number => s.crossOut + s.crossIn
  const max = Math.max(...stats.map(score))
  for (const s of stats) {
    if (max <= 0) {
      s.risk = 'green'
      continue
    }
    const r = score(s) / max
    s.risk = r > 0.6 ? 'red' : r > 0.25 ? 'amber' : 'green'
  }
}

// ── 分析结果的形状 ──────────────────────────────────────────────────────────
//
// **放在 shared 而不是主进程**：渲染层要用它，而渲染层不许 import 主进程的文件
// （tsconfig.web 根本不含那些文件，硬 import 是 TS6307）。
// 跨层的线上类型只许有一份定义 —— omp 那次「每个调用方各写各的 as {...}、
// 删字段静默失效」咬过三回。

export interface CodeGraphResult {
  root: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 每个环一组边。`severity` 见 `cycleSeverity` —— type 那档不是病 */
  cycles: { edges: GraphEdge[]; severity: 'runtime' | 'type' | 'unknown' }[]
  territories: { stats: TerritoryStat[]; links: { from: string; to: string; count: number }[] }
  /** 扫了多久（ms），界面上如实显示 */
  ms: number
  /** 没能解析的依赖（如可选原生模块）。**如实报，不吞** */
  unresolved: string[]
  /** 入口是怎么来的。
   *  · `entries` —— 认出了具名入口（`src/main.tsx` / index.html 的 script / package.json main）
   *  · `dirs`    —— 一个都没认出来，退回「扫所有装着源码的目录」
   *  **界面必须如实说明用的是哪种** —— 两者回答的不是同一个问题：
   *  入口扫给的是「从入口够得着的」，目录扫给的是「目录里有的」（含死代码）。 */
  strategy: 'entries' | 'dirs'
  /** 实际交给分析器的那些入口/目录。用户能据此判断「是不是漏了我关心的那块」。 */
  scanned: string[]
  /** 领地是哪来的。
   *  · `mapped`  —— 命中了内置领地表（只有本仓库会命中），颜色表示**风险等级**
   *  · `derived` —— 按项目自己的目录结构现推，颜色表示**耦合轻重**
   *  **图例文案必须跟着换** —— 对陌生项目写「安全边界」是编造。 */
  territoryMode: 'mapped' | 'derived'
  /** 这个项目里认出了哪几种技术栈。`js` 走 dependency-cruiser，其余走 `multiLang.ts`。 */
  stacks: string[]
  /** 每种栈画出来的是什么粒度。
   *  **Swift 只有 `module`** —— 同一个 module 内的文件互相可见、不需要 import，
   *  文件级依赖图在 Swift 里根本不存在（实测 159 个文件 0 条跨文件 import）。
   *  界面必须说清楚，否则会被读成「这个项目耦合很低」。 */
  granularity: Record<string, 'file' | 'module'>
}
