import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateByTerritory,
  cycleSeverity,
  deriveTerritories,
  isTypeOnlyStatement,
  riskByCoupling,
  territoryOf,
  type GraphEdge,
  type GraphNode,
  type TerritoryStat,
  typeOnlyFor
} from './codeGraph.ts'

// ── 领地划分 ────────────────────────────────────────────────────────────────

test('**更具体的路径胜出** —— omp 不能被并进 agentChat', () => {
  assert.equal(territoryOf('src/main/agentChat/omp/launch.ts').name, 'omp 底座')
  assert.equal(territoryOf('src/main/agentChat/session.ts').name, 'AI 会话')
})

test('风险等级照抄图纸：store 与 shared 是红区', () => {
  assert.equal(territoryOf('src/renderer/src/store/tabsSlice.ts').risk, 'red')
  assert.equal(territoryOf('src/shared/types.ts').risk, 'red')
  assert.equal(territoryOf('src/renderer/src/ui/Icons.tsx').risk, 'green')
})

test('构建输出与分发产物标成 frozen（⛔ 不许手改）', () => {
  assert.equal(territoryOf('out/main/index.js').risk, 'frozen')
  assert.equal(territoryOf('site/vendor/spb-design/a.css').risk, 'frozen')
})

test('**认不出的归「未登记」，不按目录名瞎编** —— 那是要人去补图纸的信号', () => {
  assert.equal(territoryOf('tools/whatever.ts').name, '未登记')
})

// ── 纯类型引用识别（dependency-cruiser 给不了，这层是自己写的）──────────────

test('`import type X from` 是纯类型', () => {
  assert.equal(isTypeOnlyStatement("import type { A } from './x'"), true)
  assert.equal(isTypeOnlyStatement("import type A from './x'"), true)
})

test('`import { type A, type B }` 每项都带 type → 纯类型', () => {
  assert.equal(isTypeOnlyStatement("import { type A, type B } from './x'"), true)
})

test('**混着就是值引用** —— `import { type A, B }` 里 B 是值', () => {
  assert.equal(isTypeOnlyStatement("import { type A, B } from './x'"), false)
})

test('普通 import 与副作用 import 都是值引用', () => {
  assert.equal(isTypeOnlyStatement("import A from './x'"), false)
  assert.equal(isTypeOnlyStatement("import './x'"), false)
  assert.equal(isTypeOnlyStatement("import {} from './x'"), false)
})

test('`export type { X } from` 也算纯类型（再导出类型）', () => {
  assert.equal(isTypeOnlyStatement("export type { X } from './x'"), true)
})

test('**同一个模块又类型又值 → 算值引用**（运行时那条边真实存在）', () => {
  const src = `
import type { A } from './x'
import { run } from './x'
`
  assert.equal(typeOnlyFor(src, './x'), false)
})

test('全都是类型引用 → 纯类型', () => {
  const src = `
import type { A } from './x'
import type { B } from './x'
`
  assert.equal(typeOnlyFor(src, './x'), true)
})

test('**找不到那个说明符 → undefined，不许猜**', () => {
  // 经别名 / index 解析过来的边就是这种。「判不出」和「确认无害」是两件事。
  assert.equal(typeOnlyFor("import type { A } from './y'", './x'), undefined)
})

test('说明符里的正则元字符不会把匹配弄坏', () => {
  const src = "import type { A } from '../../shared/types'"
  assert.equal(typeOnlyFor(src, '../../shared/types'), true)
  // `.` 不能被当成「任意字符」而误命中别的路径
  assert.equal(typeOnlyFor(src, '..x..xshared/types'), undefined)
})

test('多行 import 也认得出来', () => {
  const src = `
import type {
  A,
  B
} from './x'
`
  assert.equal(typeOnlyFor(src, './x'), true)
})

// ── 循环依赖定性 ────────────────────────────────────────────────────────────

const e = (from: string, to: string, typeOnly: boolean | undefined): GraphEdge =>
  ({ from, to, typeOnly, circular: true }) as GraphEdge

test('**全是纯类型的环不是病**（store 那组就是这样）', () => {
  assert.equal(cycleSeverity([e('a', 'b', true), e('b', 'a', true)]), 'type')
})

test('有一条值引用就是运行时的环，要修', () => {
  assert.equal(cycleSeverity([e('a', 'b', true), e('b', 'a', false)]), 'runtime')
})

test('**判不出来的不许当无害放过** —— unknown 是独立一档', () => {
  assert.equal(cycleSeverity([e('a', 'b', true), e('b', 'a', undefined)]), 'unknown')
})

// ── 按领地聚合 ──────────────────────────────────────────────────────────────

const n = (id: string): GraphNode => {
  const t = territoryOf(id)
  return { id, territory: t.name, risk: t.risk, inDegree: 0, outDegree: 0 }
}

test('**领地内部的边不算跨界耦合**', () => {
  const nodes = [n('src/main/index.ts'), n('src/main/agent.ts')]
  const edges = [e('src/main/index.ts', 'src/main/agent.ts', false)]
  const { links } = aggregateByTerritory(nodes, edges)
  assert.equal(links.length, 0, '同一块地里的边被算成跨界了')
})

test('跨领地的边计数并排序', () => {
  const nodes = [n('src/main/index.ts'), n('src/shared/types.ts'), n('src/shared/agentChat.ts')]
  const edges = [
    e('src/main/index.ts', 'src/shared/types.ts', false),
    e('src/main/index.ts', 'src/shared/agentChat.ts', false)
  ]
  const { links, stats } = aggregateByTerritory(nodes, edges)
  assert.equal(links.length, 1)
  assert.equal(links[0].count, 2)
  assert.equal(stats.find((s) => s.name === '主进程')?.crossOut, 2)
  assert.equal(stats.find((s) => s.name === '契约层')?.crossIn, 2)
})

test('同一块地里风险不一致时取更严的（宁可标红）', () => {
  const nodes: GraphNode[] = [
    { id: 'a', territory: 'X', risk: 'green', inDegree: 0, outDegree: 0 },
    { id: 'b', territory: 'X', risk: 'red', inDegree: 0, outDegree: 0 }
  ]
  assert.equal(aggregateByTerritory(nodes, []).stats[0].risk, 'red')
})

// ── 陌生项目的领地推导 ──────────────────────────────────────────────────────
describe('deriveTerritories', () => {
  it('按第一段目录分组', () => {
    const m = deriveTerritories(['src/a.ts', 'src/b.ts', 'lib/c.ts'])
    assert.equal(m.get('src/a.ts'), 'src')
    assert.equal(m.get('lib/c.ts'), 'lib')
  })

  it('**一段吃掉大半时往下再拆一层** —— 否则整张图只剩一个巨大的 src 节点', () => {
    const paths = [
      'src/main/a.ts', 'src/main/b.ts', 'src/main/c.ts',
      'src/ui/d.ts', 'src/ui/e.ts',
      'src/store/f.ts'
    ]
    const m = deriveTerritories(paths)
    assert.equal(m.get('src/main/a.ts'), 'src/main')
    assert.equal(m.get('src/ui/d.ts'), 'src/ui')
    assert.equal(new Set(m.values()).size, 3)
  })

  it('根目录下的文件归「根目录」，不会变成空字符串', () => {
    const m = deriveTerritories(['build.js', 'serve.js'])
    assert.equal(m.get('build.js'), '根目录')
  })

  it('分组数量压在可读范围内（不会推出 100 块地）', () => {
    const paths = Array.from({ length: 200 }, (_, i) => `pkg${i}/index.ts`)
    const m = deriveTerritories(paths)
    assert.ok(new Set(m.values()).size <= 24, '组数 ' + new Set(m.values()).size)
  })

  it('空输入不炸', () => {
    assert.equal(deriveTerritories([]).size, 0)
  })
})

describe('riskByCoupling', () => {
  const mk = (name: string, cross: number): TerritoryStat => ({
    name, risk: 'green', files: 1, crossOut: cross, crossIn: 0
  })

  it('耦合最重的标红、最轻的标绿', () => {
    const s = [mk('a', 100), mk('b', 50), mk('c', 1)]
    riskByCoupling(s)
    assert.equal(s.find((x) => x.name === 'a')!.risk, 'red')
    assert.equal(s.find((x) => x.name === 'c')!.risk, 'green')
  })

  it('全都零耦合时不乱标红', () => {
    const s = [mk('a', 0), mk('b', 0)]
    riskByCoupling(s)
    assert.ok(s.every((x) => x.risk === 'green'))
  })

  it('只有一块地时不标红 —— 没有可比的对象', () => {
    const s = [mk('solo', 999)]
    riskByCoupling(s)
    assert.equal(s[0].risk, 'green')
  })
})

describe('aggregateByTerritory · 节点自带权重', () => {
  const n = (id: string, territory: string, weight?: number): GraphNode => ({
    id, territory, risk: 'green', inDegree: 0, outDegree: 0, ...(weight === undefined ? {} : { weight })
  })

  it('没有 weight 时一个节点算一个文件（原来的行为）', () => {
    const r = aggregateByTerritory([n('a.ts', 'X'), n('b.ts', 'X')], [])
    assert.equal(r.stats[0].files, 2)
  })

  it('**有 weight 就用 weight** —— Swift 的 target 是一个节点、但装着好几个文件', () => {
    const r = aggregateByTerritory([n('Sources/Core', 'Sources/Core', 6)], [])
    assert.equal(r.stats[0].files, 6, '写成 1 的话卡片上每个 target 都是「1 个文件」')
  })

  it('混合时各算各的', () => {
    const r = aggregateByTerritory([n('Core', 'Core', 5), n('a.py', 'lib'), n('b.py', 'lib')], [])
    const by = new Map(r.stats.map((s) => [s.name, s.files]))
    assert.equal(by.get('Core'), 5)
    assert.equal(by.get('lib'), 2)
  })
})
