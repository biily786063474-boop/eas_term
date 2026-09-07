// 依赖波及的纯计算。图来自 main/codeGraphAnalyze 的 analyzeProject；这里只做反查。
export interface ImpactResult {
  files: string[]
  unknown: string[]
  dependents: { file: string; direct: string[]; transitive: string[] }[]
  cycles: string[][]
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
  const inputs = files.filter((f) => known.has(f))
  const unknown = files.filter((f) => !known.has(f))
  const rev = new Map<string, string[]>()
  for (const e of graph.edges) rev.set(e.to, [...(rev.get(e.to) ?? []), e.from])
  const dependents = inputs.map((file) => {
    const direct = [...new Set(rev.get(file) ?? [])].sort()
    const seen = new Set([file, ...direct])
    const transitive = [...new Set(direct.flatMap((d) => rev.get(d) ?? []))].filter((x) => !seen.has(x)).sort()
    return { file, direct, transitive }
  })
  const inputSet = new Set(inputs)
  const cycles = graph.cycles
    .map((c) => [...new Set(c.edges.flatMap((e) => [e.from, e.to]))].sort())
    .filter((ids) => ids.some((id) => inputSet.has(id)))
  const candidates = new Set([...inputs, ...dependents.flatMap((d) => [...d.direct, ...d.transitive])])
  const suggestedTests = testFiles
    .filter((t) => [...candidates].some((c) => dirOf(t) === dirOf(c) && stem(t) === `${stem(c)}.test`))
    .sort()
  return { files: inputs, unknown, dependents, cycles, suggestedTests: [...new Set(suggestedTests)] }
}
