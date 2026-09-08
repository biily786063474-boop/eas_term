import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const { contentStat } = await import(new URL('../renderer/src/store/canvas/nodeCap.ts', import.meta.url).href)
const source = ts.createSourceFile('mcpHandler.ts', fs.readFileSync(new URL('../renderer/src/mcpHandler.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
let branch: ts.IfStatement | undefined
function visit(n: ts.Node) { if (ts.isIfStatement(n) && n.expression.getText(source) === "tool === 'canvas_open_image'") branch = n; ts.forEachChild(n, visit) }
visit(source); assert.ok(branch)
const code = ts.transpileModule('async function invoke(args,ctx){const tool="canvas_open_image";const loc=resolveFrame(ctx);' + branch.getText(source) + '}\ninvoke', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup(count: number) {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: 'existing-' + i, pane: { kind: 'image', filePath: '/project/old.png' } }))
  let valid = true
  const frame = { id: 'owned-frame', nodes }
  const state = { viewMode: 'canvas', canvas: { frames: [frame] }, setViewMode() {}, addFileNode(frameId: string, pane: unknown) { assert.equal(frameId, 'owned-frame'); frame.nodes.push({ id: 'new', pane } as any) } }
  let afterValidation = () => {}
  const invoke = runInNewContext(code, { useStore: { getState: () => state }, resolveFrame: () => valid ? { frameId: frame.id, projectPath: '/project' } : null,
    contentStat, window: { api: { fs: { validateRasterImage: async () => { afterValidation(); return { path: '/project/ok.png' } } } } } })
  return { nodes, invoke: () => invoke({ path: '/project/ok.png' }, { project: '/project' }), after: (fn: () => void) => { afterValidation = fn }, revoke: () => { valid = false } }
}
test('real renderer branch appends to owned Frame without removing existing content', async () => {
  const f = setup(4), before = f.nodes.map(n => n.id), result = await f.invoke()
  assert.equal(result.frameId, 'owned-frame'); assert.equal(result.nodeId, 'new')
  assert.deepEqual(f.nodes.slice(0, 4).map(n => n.id), before)
})
test('capacity is rechecked after async validation; full Frame rejects instead of eviction', async () => {
  const f = setup(4)
  f.after(() => f.nodes.push({ id: 'concurrent', pane: { kind: 'image', filePath: '/project/other.png' } }))
  await assert.rejects(f.invoke(), /名额已满/)
  assert.deepEqual(f.nodes.map(n => n.id), ['existing-0', 'existing-1', 'existing-2', 'existing-3', 'concurrent'])
})
test('Frame identity is rechecked after async validation', async () => {
  const f = setup(0); f.after(f.revoke)
  await assert.rejects(f.invoke(), /Frame 已变化/); assert.equal(f.nodes.length, 0)
})
