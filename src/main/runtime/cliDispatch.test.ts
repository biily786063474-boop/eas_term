import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {admitCliTurn,cliTurnQueue,onCliDispatchChange} from './cliDispatch.ts'
const sf=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const names=['dispatchCli','finishCliDispatch','cancelCliAdmission']
const code=ts.transpileModule(sf.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(sf)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const flush=()=>new Promise(r=>setImmediate(r))
test('actual session gate shares Claude/Codex/OMP capacity and cancels unstarted payload exactly once',async()=>{
 const events:any[]=[];const sessions=new Map();const starts:{cli:string;at:number}[]=[]
 const lives=['claude','codex','omp'].map(cli=>{const l={rec:{id:cli,cli,cwd:'/fixture'},wc:{isDestroyed:()=>false}};sessions.set(cli,l);return l})
 const api=runInNewContext(code+'\n({dispatchCli,finishCliDispatch,cancelCliAdmission})',{AbortController,Date,admitCliTurn,cliTurnQueue,onCliDispatchChange,sessions,projectAttribution:()=>null,loadProjects:()=>[],emitEvent:(l:any,e:any)=>events.push({id:l.rec.id,...e}),handleEvent:(l:any,e:any)=>events.push({id:l.rec.id,...e}),interruptManagedTurn(){}})
 const keepAlive=setInterval(()=>{},1000)
 try{
  const a=api.dispatchCli(lives[0],'A',()=>starts.push({cli:'claude',at:performance.now()}));await a
  const b=api.dispatchCli(lives[1],'B',()=>starts.push({cli:'codex',at:performance.now()}));await b
  assert.ok(starts[1].at-starts[0].at>=990)
  const c=api.dispatchCli(lives[2],'C',()=>starts.push({cli:'omp',at:performance.now()}));const rejected=assert.rejects(c,/取消/)
  await flush();assert.equal(starts.length,2);assert.ok(events.some(e=>e.id==='omp'&&e.queued))
  api.cancelCliAdmission(lives[2]);api.cancelCliAdmission(lives[2]);await rejected
  assert.equal(events.filter(e=>e.k==='message.unsent'&&e.text==='C').length,1)
  api.finishCliDispatch(lives[0]);api.finishCliDispatch(lives[1]);assert.equal(cliTurnQueue.snapshot().length,0)
 }finally{clearInterval(keepAlive);for(const l of lives)api.finishCliDispatch(l)}
})

test('actual dispatch revalidates transport before clearing original payload',async()=>{
 const events:any[]=[];const live:any={rec:{id:'validation',cli:'claude',cwd:'/fixture'},wc:{isDestroyed:()=>false}}
 const api=runInNewContext(code+'\n({dispatchCli,finishCliDispatch})',{AbortController,Date,admitCliTurn,cliTurnQueue,onCliDispatchChange,sessions:new Map([['validation',live]]),projectAttribution:()=>null,loadProjects:()=>[],emitEvent:(l:any,e:any)=>events.push(e),handleEvent(){},interruptManagedTurn(){}})
 const keepAlive=setInterval(()=>{},1000);let sent=false
 try{await assert.rejects(api.dispatchCli(live,'preserve me',()=>{sent=true},()=>{throw Error('transport closed')}),/transport closed/);assert.equal(sent,false);assert.equal(live.dispatchPending,'preserve me');assert.equal(cliTurnQueue.snapshot().length,0)}finally{clearInterval(keepAlive);api.finishCliDispatch(live)}
})
