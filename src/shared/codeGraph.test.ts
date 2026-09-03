import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateByTerritory,
  cycleSeverity,
  isTypeOnlyStatement,
  territoryOf,
  typeOnlyFor,
  type GraphEdge,
  type GraphNode
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
