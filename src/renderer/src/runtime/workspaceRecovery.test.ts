import {test} from 'node:test'
import assert from 'node:assert/strict'
import {workspaceRecoveryBlockers, workspaceRecoveryKeys} from './workspaceRecovery.ts'
const scene=()=>({tabs:[],canvas:{frames:[],freeNodes:[]},pendingConfirm:null,editingSticky:null})
test('empty workspace is known; tabs preserve IDs and both split children are checked',()=>{
 const s=scene();assert.deepEqual(workspaceRecoveryBlockers(s),[])
 const tabs=[{root:{type:'split',children:[{type:'leaf',id:'a',pane:{kind:'agent'}},{type:'leaf',id:'b',pane:{kind:'terminal'}}]}}]
 assert.ok(workspaceRecoveryBlockers({...s,tabs}).includes('pane:terminal'))
 for(const key of ['tabs','activeTabId','activeTabByProject','canvas','canvasUndo','activeProjectId'])assert.ok(workspaceRecoveryKeys.includes(key))
})
test('unknown panels, plugins, browser, editors and pending work veto, not silently discard',()=>{
 for(const pane of [{kind:'web'},{kind:'code'},{kind:'future'},{kind:'agent',sessionId:'ac-1'},{kind:'agent',initialMessage:'auto'}]){
  assert.ok(workspaceRecoveryBlockers({...scene(),tabs:[{root:{type:'leaf',id:'a',pane}}]}).length)
 }
 for(const node of [{id:'n',component:{type:'plugin'}},{id:'n',pane:{kind:'web'}},{id:'n'}]){
  assert.ok(workspaceRecoveryBlockers({...scene(),canvas:{frames:[],freeNodes:[node]}}).length)
 }
 assert.ok(workspaceRecoveryBlockers({...scene(),pendingConfirm:{}}).length)
 assert.ok(workspaceRecoveryBlockers({...scene(),editingSticky:'s'}).length)
})
test('open drawers, pending archive and transient transcription results veto replacement',()=>{
 for(const extra of [{wikiDrawerOpen:true},{resDrawerOpen:true},{dictOpen:true},{pendingArchive:{}},{ttQueue:[{state:'done',text:'unsaved'}]}])assert.ok(workspaceRecoveryBlockers({...scene(),...extra}).length)
})
