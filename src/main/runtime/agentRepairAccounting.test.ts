import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {UsageBook} from '../usage/core.ts'
test('dead ACP UI repair preserves retained usage row, suppresses success and credits later real B to B',()=>{
 const sf=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const funcs=sf.statements.filter(n=>ts.isFunctionDeclaration(n)&&['handleEvent','interruptManagedTurn'].includes(n.name?.text??''))
 const code=ts.transpileModule(funcs.map(n=>n.getText(sf)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const book=new UsageBook(),meta={session:'s',cli:'omp',project:'p',projectName:'p',model:'m'}
 book.start(meta,'retained-B',1)
 const live={rec:{id:'s',cli:'omp',cwd:'/p',busy:true},acp:{phase:()=> 'dead',interrupt:()=>false}}
 const noop=()=>{},events:any[]=[]
 const api=runInNewContext(code+'\n({interruptManagedTurn,handleEvent})',{
  sessions:new Map([['s',live]]),retirePlanTurn:noop,cancelPluginTurn:noop,cancelRuntimeStartup:noop,isSilenced:()=>false,
  captureUsage:(r:any,e:any)=>{if(e.k==='turn.done')book.finish(r.id,e.meter,undefined,2,e.interrupted?'interrupted':'completed')},
  observePluginTurn:noop,BG_TOOLS:new Set(),getAdapter:()=>({quotaSource:'omp-usage'}),scheduleOmpRefresh:noop,refreshBoard:noop,projectRootOf:(x:unknown)=>x,
  emitEvent:(_:unknown,e:unknown)=>events.push(e),signalPlanStop:noop,queueMicrotask:noop,activePlanTurn:()=>null,tally:(prev:unknown)=>prev,ZERO_TALLY:{}
 })
 api.interruptManagedTurn('s')
 assert.equal(book.rows[0].status,'running');assert.equal(book.rows[0].endedAt,undefined)
 assert.equal(events[0].interrupted,true);assert.equal(events[0].usageKnown,false);assert.equal(live.rec.busy,false)
 book.start(meta,'later-C',2)
 api.handleEvent(live,{k:'turn.done',meter:{input:9,output:3},usage:{inputTokens:9,outputTokens:3}})
 assert.equal(book.rows[0].status,'completed');assert.equal(book.rows[0].meter?.input,9)
 assert.equal(book.rows[1].status,'running');assert.equal(book.rows[1].meter,undefined)
})
