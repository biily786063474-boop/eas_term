import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source=fs.readFileSync(new URL('./canvasSlice.ts',import.meta.url),'utf8')
function action(name,end){const i=source.indexOf(name+': async');return ts.transpileModule('const action={'+source.slice(i,source.indexOf(end,i))+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText}
test('adding a terminal to frame attaches only the returned leaf, not a concurrent tab',async()=>{
 let state={canvas:{frames:[{id:'frame',projectId:'p',nodes:[]}]},tabs:[],openTerminal:async()=>{state.tabs=[{root:{id:'concurrent',pane:{kind:'terminal'}}},{root:{id:'own',pane:{kind:'terminal'}}}];return 'own'}}
 const js=action('addTerminalNode','\n  // 与 addTerminalNode')
 const run=new Function('get','set','collectLeaves','uid','reflowSeparate','placeNodeInFrame','NODE_W','NODE_H',js+';return action.addTerminalNode')(()=>state,fn=>{state={...state,...fn(state)}},root=>[root],()=> 'node',frames=>frames,(f,n)=>({...f,nodes:[...f.nodes,n]}),600,400)
 assert.equal(await run('frame'),'own');assert.equal(state.canvas.frames[0].nodes[0].leafId,'own')
})
for (const change of ['closed','replaced','unchanged']) test('delayed terminal prefill rechecks ownership: '+change,async()=>{
 const original={kind:'terminal',ptyId:'own-pty'}
 let state={viewMode:'tabs',canvas:{frames:[]},tabs:[{root:{id:'own',pane:original}}],openTerminal:async()=> 'own'}
 const writes=[];let timer
 const js=action('prefillTerminal','\n  addBrowserNode:')
 const run=new Function('get','collectLeaves','setTimeout','window',js+';return action.prefillTerminal')(()=>state,root=>[root],fn=>{timer=fn},{api:{pty:{write:(...args)=>writes.push(args)}}})
 await run('install-approved',{run:true})
 if(change==='closed')state.tabs=[]
 if(change==='replaced')state.tabs=[{root:{id:'own',pane:{kind:'terminal',ptyId:'replacement'}}}]
 timer()
 assert.deepEqual(writes,change==='unchanged'?[['own-pty','install-approved\r']]:[])
})
