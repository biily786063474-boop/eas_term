// 依赖波及的纯计算。图来自 main/codeGraphAnalyze 的 analyzeProject；这里只做反查。
export interface ImpactResult {
  /** 输入里在图上找得到的（模块级图时是所属节点 id，去重） */
  files: string[]
  /** 图上没有的（非源码 / 未扫到 / 不属于任何模块节点） */
  unknown: string[]
  /** 反向依赖：direct 是直接 import 它的；indirect 只到第二层（import 了 direct 的那些），
   *  **不是完整闭包** —— 再往上的层级不展开，要全量得自己迭代。 */
  dependents: { file: string; direct: string[]; indirect: string[] }[]
  /** 涉及输入文件的环。每项是一个循环分量的节点 id 列表（排序去重），不一定是单个简单环。 */
  cycles: string[][]
  /** 建议回归：输入文件与其 dependents 同目录同名的 `*.test.*`（如 `a.ts` → `a.test.ts` / `a.test.mjs`），
   *  去重排序。**只认同目录同名**，`__tests__/` 与 `*.spec.*` 不认。 */
  suggestedTests: string[]
}

interface GraphLike {
  nodes: { id: string }[]
  edges: { from: string; to: string; circular?: boolean }[]
  cycles: { edges: { from: string; to: string }[] }[]
}

const dirOf = (f: string): string => f.split('/').slice(0, -1).join('/')
const stem = (f: string): string => (f.split('/').pop() ?? '').replace(/\.[^.]+$/, '')

export function impactFrom(graph: GraphLike, files: string[], testFiles: string[]): ImpactResult {
  const known = new Set(graph.nodes.map((n) => n.id))
  // 文件级图直接命中；模块级图（节点 id 是目录，如 Swift 的 `Sources/GestureCore`）按最长前缀归属
  const resolve = (f: string): string | null => {
    if (known.has(f)) return f
    let best: string | null = null
    for (const id of known) if (f.startsWith(`${id}/`) && (best === null || id.length > best.length)) best = id
    return best
  }
  const inputs: string[] = []
  const unknown: string[] = []
  for (const f of files) {
    const id = resolve(f)
    if (id === null) unknown.push(f)
    else if (!inputs.includes(id)) inputs.push(id)
  }
  const rev = new Map<string, string[]>()
  for (const e of graph.edges) rev.set(e.to, [...(rev.get(e.to) ?? []), e.from])
  const dependents = inputs.map((file) => {
    const direct = [...new Set(rev.get(file) ?? [])].sort()
    const seen = new Set([file, ...direct])
    const indirect = [...new Set(direct.flatMap((d) => rev.get(d) ?? []))].filter((x) => !seen.has(x)).sort()
    return { file, direct, indirect }
  })
  const inputSet = new Set(inputs)
  const cycles = graph.cycles
    .map((c) => [...new Set(c.edges.flatMap((e) => [e.from, e.to]))].sort())
    .filter((ids) => ids.some((id) => inputSet.has(id)))
  const candidates = new Set([...inputs, ...dependents.flatMap((d) => [...d.direct, ...d.indirect])])
  const suggestedTests = testFiles
    .filter((t) => [...candidates].some((c) => dirOf(t) === dirOf(c) && stem(t) === `${stem(c)}.test`))
    .sort()
  return { files: inputs, unknown, dependents, cycles, suggestedTests: [...new Set(suggestedTests)] }
}
