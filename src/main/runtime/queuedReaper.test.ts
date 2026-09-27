import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
test('idle reaper never kills resource-waiting sessions but still reaps eligible idle ones',()=>{
 const sf=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const fn=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='reapIdleSessions')!
 const code=ts.transpileModule(fn.getText(sf),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let stopped=0
 const base={alive:true,busy:true,id:'s',cwd:'/fixture',lastActiveAt:0}
 const queued:any={rec:{...base},runtimeStartupId:'waiting',proc:{}}
 const acp:any={rec:{...base},acp:{phase:()=> 'opening',close(){stopped++}}}
 const idle:any={rec:{...base},proc:{}}
 const reap=runInNewContext(code+'\nreapIdleSessions',{sessions:new Map([['a',queued],['b',acp],['c',idle]]),Date,hasDelivered:()=>false,shouldReap:()=>true,logSession(){},stopAgentProcess(){stopped++}})
 reap();assert.equal(stopped,1);assert.equal(queued.rec.alive,true);assert.equal(acp.rec.alive,true);assert.equal(idle.rec.alive,false)
})
