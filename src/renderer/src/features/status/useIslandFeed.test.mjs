import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { collectLeaves } from '../../layout.ts'
import { locate, attentionKindOf, statusOf, urgencyCmp } from './machine.ts'
import { getIslandResult, putIslandResult, dropIslandResult, islandReadKey } from './islandResults.ts'
const source = fs.readFileSync(new URL('./useIslandFeed.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function harness(kind = 'terminal') {
  const id = kind === 'agent' ? 'ac-test' : 'pty-test'
  const pane = kind === 'agent' ? { kind, sessionId: id, cwd: '/project', resumeCli: 'codex' } : { kind, ptyId: id }
  const state = { tabs: [{id:'tab',projectId:'p',root:{type:'leaf',id:'leaf',pane}}],
    projects:[{id:'p',path:'/project',name:'project'}],
    canvas:{frames:[{id:'frame',nodes:[{id:'node',leafId:'leaf',agent:{kind:'claude',session:{claude:'bound'}}}]}]},
    attentionPtys:[id], runningPtys:[], ptyTiming:{[id]:{lastDoneAt:100,lastRoundMs:10}}, ptyApproval:{},
    approvalSentAt:{}, silencedNotices:[], pruneSilenced:()=>{} }
  const values=[], refs=[], pending=[]
  let si=0, ri=0, effects=[]
  const useStore=selector=>selector(state); useStore.getState=()=>state
  const useState=initial=>{
    const i=si++; if(!(i in values))values[i]=initial
    return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]
  }
  const useRef=initial=>refs[ri++]??(refs[ri-1]={current:initial})
  const api={session:{last:(cwd,sid)=>new Promise(resolve=>pending.push({cwd,sid,resolve}))},island:{sync:()=>{},onAction:()=>()=>{}}}
  const exports={}
  new Function('exports','useStore','useState','useRef','useEffect','collectLeaves','locate','attentionKindOf','statusOf','urgencyCmp','focusTerminal','getIslandResult','islandReadKey','window',js)(
    exports,useStore,useState,useRef,fn=>effects.push(fn),collectLeaves,locate,attentionKindOf,statusOf,urgencyCmp,()=>{},getIslandResult,islandReadKey,{api})
  return {id,state,pending,values,render(){si=0;ri=0;effects=[];exports.useIslandFeed();return effects[0]()}}
}
test('terminal read is bound, stale session reply cannot write into a changed binding', async()=>{
  const h=harness();h.render()
  assert.equal(h.pending[0].sid,'bound')
  h.state.canvas.frames[0].nodes[0].agent.session.claude='new-session'
  h.pending[0].resolve({found:true,ask:'wrong',answer:'wrong',at:1,answeredAt:99})
  await Promise.resolve()
  assert.equal(h.values[0][h.id],undefined)
})
test('late reply is rejected after cleanup, restart, or module removal',async()=>{
  for(const change of ['cleanup','restart','remove']){
    const h=harness(),cleanup=h.render()
    if(change==='cleanup')cleanup()
    if(change==='restart'){h.state.runningPtys=[h.id];h.state.ptyTiming[h.id].roundStart=200}
    if(change==='remove')h.state.tabs=[]
    h.pending[0].resolve({found:true,ask:'old',answer:'old',at:1,answeredAt:99})
    await Promise.resolve()
    assert.equal(h.values[0][h.id],undefined,change)
  }
})
test('AI module reads only its live result, never Claude files in the same project',()=>{
  const h=harness('agent')
  putIslandResult(h.id,'leaf',{answer:'Codex模块结果',ask:'',at:100,round:1},100)
  h.render()
  assert.equal(h.pending.length,0)
  assert.equal(h.values[0][h.id].answer,'Codex模块结果')
  h.state.ptyTiming[h.id].lastDoneAt=200
  h.render()
  assert.equal(h.values[0][h.id],undefined)
  dropIslandResult(h.id)
})
test('unbound terminal does not issue a project-wide read',()=>{
  const h=harness();h.state.canvas.frames[0].nodes[0].agent.session={}
  h.render();assert.equal(h.pending.length,0)
})
test('a bound terminal cannot reuse the preceding round final answer',async()=>{
  const h=harness()
  h.state.ptyTiming[h.id]={lastDoneAt:20000,lastRoundMs:5000}
  h.render()
  h.pending[0].resolve({found:true,ask:'上一轮',answer:'上一轮结果',at:1000,answeredAt:2000})
  await Promise.resolve()
  assert.equal(h.values[0][h.id],undefined)
})
test('only the bound terminal result inside this completed round is accepted',async()=>{
  const h=harness()
  h.state.ptyTiming[h.id]={lastDoneAt:20000,lastRoundMs:5000}
  h.render()
  h.pending[0].resolve({found:true,ask:'本轮',answer:'本轮结果',at:14000,answeredAt:19000})
  await Promise.resolve()
  assert.equal(h.values[0][h.id].answer,'本轮结果')
})
