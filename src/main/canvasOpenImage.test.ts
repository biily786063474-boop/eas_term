import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const { contentStat, nodesToEvict } = await import(new URL('../renderer/src/store/canvas/nodeCap.ts', import.meta.url).href)
const source = ts.createSourceFile('mcpHandler.ts', fs.readFileSync(new URL('../renderer/src/mcpHandler.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
let branch: ts.IfStatement | undefined
function visit(n: ts.Node) { if (ts.isIfStatement(n) && n.expression.getText(source) === "tool === 'canvas_open_image'") branch = n; ts.forEachChild(n, visit) }
visit(source); assert.ok(branch)
const code = ts.transpileModule('async function invoke(args,ctx){const tool="canvas_open_image";const loc=resolveFrame(ctx);' + branch.getText(source) + '}\ninvoke', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup(count: number) {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: 'existing-' + i, pane: { kind: 'image', filePath: '/project/old.png' } }))
  let valid = true
  const frame = { id: 'owned-frame', nodes }
  const state = { viewMode: 'canvas', canvas: { frames: [frame] }, setViewMode() {}, addFileNode(frameId: string, pane: unknown) { assert.equal(frameId, 'owned-frame'); frame.nodes.push({ id: 'new', pane } as any); const gone=new Set(nodesToEvict(frame.nodes as any)); for(let i=frame.nodes.length-1;i>=0;i--) if(gone.has(frame.nodes[i].id))frame.nodes.splice(i,1) } }
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
test('capacity after async validation evicts oldest content and reports it', async () => {
  const f=setup(4);f.after(()=>f.nodes.push({id:'concurrent',pane:{kind:'image',filePath:'/project/other.png'}}))
  const r=await f.invoke()
  assert.deepEqual(f.nodes.map(n=>n.id),['existing-1','existing-2','existing-3','concurrent','new'])
  assert.equal(r.content_slots,'5/5');assert.deepEqual(Array.from(r.evicted_node_ids),['existing-0'])
})
test('pinned content and live nodes are never evicted',async()=>{
 const f=setup(6);Object.assign(f.nodes[0],{pinned:true});f.nodes.unshift({id:'live',leafId:'leaf',pane:{kind:'agent'}} as any)
 const r=await f.invoke();assert.ok(f.nodes.some(n=>n.id==='existing-0'));assert.ok(f.nodes.some(n=>n.id==='live'));assert.deepEqual(Array.from(r.evicted_node_ids),['existing-1'])
})
test('Frame identity is rechecked after async validation', async () => {
  const f = setup(0); f.after(f.revoke)
  await assert.rejects(f.invoke(), /Frame 已变化/); assert.equal(f.nodes.length, 0)
})
