import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {pendingPaneStarts} from './pendingPaneStarts.ts'
const source=readFileSync(new URL('./tabsSlice.ts',import.meta.url),'utf8')
const start=source.indexOf('openTerminal: async'),end=source.indexOf('\n  // 与 openTerminal',start)
const js=ts.transpileModule('const action={'+source.slice(start,end)+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
function fixture(){
 let state={activeProjectId:'p',projects:[{id:'p',path:'/fixture',name:'Fixture'}],tabs:[],activeTabByProject:{},canvas:{frames:[{id:'f',projectId:'p'}]}},seq=0,resolve
 const killed=[]
 const run=new Function('pendingPaneStarts','get','set','uid','track','projectKey','window',js+';return action.openTerminal')(pendingPaneStarts,()=>state,fn=>{state={...state,...fn(state)}},prefix=>prefix+'-'+ ++seq,()=>{},s=>s,{api:{pty:{create:()=>new Promise(r=>resolve=r),kill:id=>killed.push(id)},runtimeCancelTask:async()=>({ok:true})}})
 return {run,resolve:r=>resolve(r),state:()=>state,killed,removeFrame:()=>{state={...state,canvas:{frames:[]}}}}
}
test('terminal creation returns its own leaf identity rather than scanning concurrent tabs',async()=>{
 const f=fixture(),waiting=f.run({projectId:'p'});f.resolve({id:'new'});const leaf=await waiting
 assert.equal(leaf,f.state().tabs[0].root.id)
})
test('frame removed during startup does not receive a late terminal or leave a tab',async()=>{
 const f=fixture(),waiting=f.run({projectId:'p',sourceFrameId:'f'});f.removeFrame();f.resolve({id:'late'})
 assert.equal(await waiting,undefined);assert.deepEqual(f.killed,['late']);assert.equal(f.state().tabs.length,0)
})
