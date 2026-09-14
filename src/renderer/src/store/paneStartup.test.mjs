import {pendingPaneStarts} from './pendingPaneStarts.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('./tabsSlice.ts',import.meta.url),'utf8')
const start=source.indexOf('setPaneKind: async')
const end=source.indexOf('\n  // agent 会话建立成功',start)
const js=ts.transpileModule('const action={'+source.slice(start,end)+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
function fixture(){
 const original={type:'leaf',id:'leaf',pane:{kind:'agent',cwd:'/fixture',sessionId:'keep'}}
 let state={tabs:[{id:'tab',cwd:'/fixture',root:original}]},resolve,reject
 const killed=[],retired=[]
 const run=new Function('uid','pendingPaneStarts','get','set','collectLeaves','updatePane','killPanePty','window',js+';return action.setPaneKind')(()=> 'test-request',pendingPaneStarts,()=>state,fn=>{state={...state,...fn(state)}},root=>[root],(root,_id,pane)=>({...root,pane}),pane=>retired.push(pane),{api:{pty:{create:()=>new Promise((a,b)=>{resolve=a;reject=b}),kill:id=>killed.push(id)}}})
 return {original,run,killed,retired,state:()=>state,close:()=>{state={tabs:[]}},resolve:r=>resolve(r),reject:e=>reject(e)}
}
test('pane replacement keeps current AI until terminal admission actually succeeds',async()=>{
 const f=fixture(),waiting=f.run('tab','leaf','terminal')
 assert.equal(f.retired.length,0)
 f.resolve({id:'new'});await waiting
 assert.equal(f.retired[0],f.original.pane);assert.equal(f.state().tabs[0].root.pane.ptyId,'new')
})
test('terminal admission failure never kills old pane',async()=>{
 const f=fixture(),waiting=f.run('tab','leaf','terminal')
 f.reject(Error('cancelled'));await assert.rejects(waiting,/cancelled/)
 assert.equal(f.retired.length,0);assert.equal(f.state().tabs[0].root,f.original)
})
test('pane closed while waiting does not leak a late terminal',async()=>{
 const f=fixture(),waiting=f.run('tab','leaf','terminal');f.close()
 f.resolve({id:'late'});await waiting
 assert.deepEqual(f.killed,['late']);assert.equal(f.retired.length,0)
})
