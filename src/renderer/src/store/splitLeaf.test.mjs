import {pendingPaneStarts} from './pendingPaneStarts.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Exercise the actual slice action with isolated store/IPC dependencies.
const source = readFileSync(new URL('./tabsSlice.ts', import.meta.url), 'utf8')
const action = source.slice(source.indexOf('splitLeaf: async'), source.indexOf('\n  closeLeaf:', source.indexOf('splitLeaf: async')))
const js = ts.transpileModule('const action = {' + action + '};', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
async function split(pane, dir = 'row') {
  const original = { type: 'leaf', id: 'old', pane }
  let state = { tabs: [{ id: 'tab', cwd: '/project', root: original }] }
  let created = 0
  const run = new Function('pendingPaneStarts','get', 'set', 'collectLeaves', 'replaceLeaf', 'uid', 'window', js + ';return action.splitLeaf')(
    pendingPaneStarts,    () => state, fn => { state = { ...state, ...fn(state) } },
    root => [root], (_root, _id, replacement) => replacement,
    prefix => prefix + '-new', { api: { pty: { create: async () => { created++; return { id: 'new-pty' } } } } }
  )
  await run('tab', 'old', dir)
  const root = state.tabs[0].root
  assert.equal(root.children[0], original)
  assert.equal(root.dir, dir)
  return { pane: root.children[1].pane, created }
}
for (const dir of ['row', 'column']) test(`AI ${dir} split starts fresh, never adopts or auto-sends`, async () => {
  const pane = { kind: 'agent', cwd: '/project', sessionId: 'live', resumeId: 'history', resumeCli: 'codex',
    initialMessage: 'run task', draft: 'old draft', owner: 'team', role: 'worker', roleId: 'builder',
    cli: 'codex', pluginId: 'plugin', worktree: { relPath: '.worktrees/old', branch: 'old' } }
  const before = structuredClone(pane)
  assert.deepEqual((await split(pane, dir)).pane, { kind: 'agent', cwd: '/project' })
  assert.deepEqual(pane, before)
})
test('terminal split still creates an independent PTY', async () => {
  assert.deepEqual(await split({ kind: 'terminal', ptyId: 'old-pty' }), { pane: { kind: 'terminal', ptyId: 'new-pty' }, created: 1 })
})
test('file split still duplicates the preview', async () => {
  const pane = { kind: 'code', filePath: '/project/a.ts' }
  const result = await split(pane)
  assert.deepEqual(result.pane, pane)
  assert.notEqual(result.pane, pane)
})

for(const change of ['closed','replaced'])test(`terminal split releases late PTY when source is ${change} during admission`,async()=>{
 const original={type:'leaf',id:'old',pane:{kind:'terminal',ptyId:'old-pty'}}
 let state={tabs:[{id:'tab',cwd:'/project',root:original}]},resolve
 const killed=[]
 const run=new Function('pendingPaneStarts','get','set','collectLeaves','replaceLeaf','uid','window',js+';return action.splitLeaf')(
  pendingPaneStarts,  ()=>state,fn=>{state={...state,...fn(state)}},root=>[root],(_root,_id,replacement)=>replacement,
  prefix=>prefix+'-new',{api:{pty:{create:()=>new Promise(r=>resolve=r),kill:id=>killed.push(id)}}})
 const waiting=run('tab','old','row')
 state=change==='closed'?{tabs:[]}:{tabs:[{id:'tab',cwd:'/project',root:{...original,pane:{kind:'agent',cwd:'/project'}}}]}
 resolve({id:'late-pty'});await waiting
 assert.deepEqual(killed,['late-pty'])
 if(change==='replaced')assert.equal(state.tabs[0].root.pane.kind,'agent')
})

test('closing source intent cancels pending main startup without creating a split',async()=>{
 let state={tabs:[{id:'tab',cwd:'/project',root:{type:'leaf',id:'source',pane:{kind:'terminal',ptyId:'old'}}}]},reject
 let createOpts,cancelId
 const run=new Function('pendingPaneStarts','get','set','collectLeaves','replaceLeaf','uid','window',js+';return action.splitLeaf')(
  pendingPaneStarts,()=>state,fn=>{state={...state,...fn(state)}},root=>[root],(_root,_id,replacement)=>replacement,prefix=>prefix+'-fixture',
  {api:{pty:{create:opts=>{createOpts=opts;return new Promise((_,r)=>reject=r)},kill(){throw Error('never spawned')}},runtimeCancelTask:async id=>{cancelId=id;reject(Error('cancelled'));return {ok:true}}}})
 const waiting=run('tab','source','row');pendingPaneStarts.cancel('source');await waiting
 assert.equal(cancelId,'pty-request:'+createOpts.startupRequestId);assert.equal(state.tabs[0].root.id,'source')
})
