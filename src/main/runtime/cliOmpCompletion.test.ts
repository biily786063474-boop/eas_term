import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
const sf=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
let method:ts.Node|undefined
function visit(n:ts.Node){if(ts.isMethodDeclaration(n)&&n.name.getText(sf)==='runPrompt')method=n;ts.forEachChild(n,visit)}visit(sf)
const code=ts.transpileModule('const deps={'+method!.getText(sf)+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const flush=()=>new Promise(r=>setImmediate(r))
test('OMP local close waits for owned process completion, normal response releases immediately',async()=>{
 for(const closed of [true,false]){
  let exit!:()=>void,released=0
  const live:any={dispatchKey:'key'}
  const fn=runInNewContext(code+'\ndeps.runPrompt',{currentProcess:{completed:new Promise<void>(r=>exit=r)},live,cancelCliAdmission(){},dispatchCli:async(_l:any,_m:string,start:()=>void)=>start(),handleEvent(){},finishCliDispatch(_l:any,key:string){assert.equal(key,'key');released++}})
  const pending=fn('message',()=>closed?Promise.reject(Error('local close')):Promise.resolve({stopReason:'end_turn'}),new AbortController().signal)
  const done=closed?assert.rejects(pending,/local close/):pending
  await flush();assert.equal(released,closed?0:1)
  exit();await done;assert.equal(released,1)
 }
})
