import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadLedger, saveLedger, queryLedger, csvOf, validateQuery } from './storage.ts'
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'usage-test-'))
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
test('atomic persistence and reboot running rounds become interrupted', async () => {
 const file=path.join(dir,'a.json')
 await saveLedger(file,{version:1,since:1,rows:[{id:'1',session:'s',project:'/a',projectName:'A',cli:'codex',model:'m',startedAt:Date.now(),status:'running'}]})
 const got=loadLedger(file); assert.equal(got.rows[0].status,'interrupted'); assert.equal(got.since,1)
})
test('malformed file is not interpreted as empty successful ledger',()=>{
 const file=path.join(dir,'bad.json'); fs.writeFileSync(file,'bad')
 assert.throws(()=>loadLedger(file)); assert.equal(fs.readFileSync(file,'utf8'),'bad')
})
test('query validates ranges and pages; export escapes spreadsheet formulas',()=>{
 assert.throws(()=>validateQuery({from:3,to:2})); assert.throws(()=>validateQuery({from:0,to:1,page:-1}))
 const row={id:'1',session:'s',project:'/a',projectName:'=CMD()',cli:'codex',model:'m',startedAt:100,status:'completed' as const,meter:{input:2,output:3}}
 const q=queryLedger({version:1,since:1,rows:[row]}, {from:0,to:200})
 assert.equal(q.summary.tokens,5); assert.equal(q.buckets.reduce((n,b)=>n+b.summary.tokens,0),5)
 assert.match(csvOf([row]),/'=CMD/)
})
test('malformed stage is rejected before it can crash the renderer',()=>{
 const file=path.join(dir,'bad-stage.json')
 fs.writeFileSync(file,JSON.stringify({version:1,since:1,rows:[{id:'1',session:'s',project:'/a',projectName:'A',cli:'codex',model:'m',startedAt:10,status:'completed',stage:{}}]}))
 assert.throws(()=>loadLedger(file))
})
test('mini trend treats mixed measured zero and unknown independently of order',()=>{
 const base={session:'s',project:'/a',projectName:'A',cli:'codex',model:'m',startedAt:100,status:'completed' as const}
 const a={...base,id:'a',meter:{input:0,output:0}},b={...base,id:'b'}
 const left=queryLedger({version:1,since:1,rows:[a,b]},{from:0,to:200}).projects[0].trend
 const right=queryLedger({version:1,since:1,rows:[b,a]},{from:0,to:200}).projects[0].trend
 assert.deepEqual(left,right)
})
test('session totals cover the whole selected period, not just current page',()=>{
 const rows=Array.from({length:150},(_,i)=>({id:''+i,session:'one',project:'/a',projectName:'A',cli:'codex',model:'m',startedAt:100+i,status:'completed' as const,meter:{input:2,output:3}}))
 const d=queryLedger({version:1,since:1,rows},{from:0,to:300,page:1})
 assert.equal(d.rows.length,50);assert.equal(d.sessions[0].summary.rounds,150);assert.equal(d.sessions[0].summary.tokens,750)
})
test('a ledger too large to read is never written over the previous file',async()=>{
 const file=path.join(dir,'bounded.json');await saveLedger(file,{version:1,since:1,rows:[]})
 const row={id:'huge',session:'s',project:'/a',projectName:'x'.repeat(41*1024*1024),cli:'codex',model:'m',startedAt:100,status:'completed' as const}
 await assert.rejects(saveLedger(file,{version:1,since:1,rows:[row]}))
 assert.equal(loadLedger(file).rows.length,0)
})
