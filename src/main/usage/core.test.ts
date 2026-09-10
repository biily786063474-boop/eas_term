import test from 'node:test'
import assert from 'node:assert/strict'
import { measure, UsageBook, summarize } from './core.ts'

test('unknown and synthetic zero differ from explicitly reported zero', () => {
  assert.equal(measure('codex', {}), undefined)
  assert.deepEqual(measure('codex', {input_tokens: 0, output_tokens: 0}), {input:0, output:0})
  assert.equal(measure('claude', {input_tokens:NaN, output_tokens:2}), undefined)
})
test('Codex cache is included; Claude cache reads and writes are separate', () => {
  assert.deepEqual(measure('codex', {input_tokens:100, output_tokens:2, cached_input_tokens:80}), {input:100, output:2, cacheRead:80})
  assert.deepEqual(measure('claude', {input_tokens:10, output_tokens:2, cache_read_input_tokens:80, cache_creation_input_tokens:20}), {input:110, output:2, cacheRead:80, cacheWrite:20})
})
const meta = {session:'s', project:'/a', projectName:'A', cli:'claude', model:'test'}
test('one active round, duplicate completion ignored, cumulative cost baseline not fabricated', () => {
  const b = new UsageBook()
  b.start(meta, '1', 100); b.start(meta, '1', 101)
  b.finish('s', {input:3,output:2}, 4, 110)
  b.finish('s', {input:300,output:200}, 4, 111)
  b.start(meta, '2', 200); b.finish('s', {input:7,output:3}, 4.2, 210)
  assert.equal(b.rows.length, 2)
  assert.equal(b.rows[0].costUsd, undefined)
  assert.ok(Math.abs(b.rows[1].costUsd! - .2) < 1e-9)
  b.resetCost('s'); b.start(meta, '3', 300); b.finish('s', undefined, 1, 310)
  assert.equal(b.rows[2].costUsd, undefined)
  assert.equal(b.rows[2].meter, undefined)
})
test('time boundaries, missing usage coverage, and project selection use request start', () => {
  const b = new UsageBook()
  b.start(meta,'1',100); b.finish('s',{input:10,output:5},undefined,250)
  b.start(meta,'2',200); b.finish('s',undefined,undefined,260)
  const s = summarize(b.rows,100,200)
  assert.equal(s.rounds,1); assert.equal(s.tokens,15); assert.equal(s.known,1)
  assert.equal(summarize(b.rows,100,300).known,1)
  assert.equal(summarize(b.rows,100,300,'/ab').rounds,0)
})
test('explicit failure state and retention limits', () => {
  const b = new UsageBook()
  b.start(meta,'1',10); b.finish('s',undefined,undefined,20,'interrupted')
  assert.equal(b.rows[0].status,'interrupted')
  b.prune(1000,500,10); assert.equal(b.rows.length,0)
})
test('OMP totalTokens is authoritative and includes cache; cancellation retains reported usage',()=>{
 assert.deepEqual(measure('omp',{inputTokens:10,outputTokens:5,totalTokens:115,cachedReadTokens:80,cachedWriteTokens:20}),{input:110,output:5,cacheRead:80,cacheWrite:20})
 const b=new UsageBook();b.start(meta,'a',10);b.markInterrupted('s');b.finish('s',{input:10,output:1},undefined,20)
 assert.equal(b.rows[0].status,'interrupted');assert.equal(b.rows[0].meter?.input,10)
})

test('queued Claude deliveries each retain a round and their own cost delta',()=>{
 const b=new UsageBook();b.start(meta,'a',1);b.start(meta,'b',2);b.finish('s',{input:1,output:1},1,3);b.finish('s',{input:2,output:2},2,4);b.start(meta,'c',5);b.finish('s',{input:3,output:3},3,6)
 assert.equal(b.rows.length,3);assert.equal(b.rows[1].costUsd,1);assert.equal(b.rows[2].costUsd,1)
})
test('cost gaps and decreasing counters cannot be charged to later turns',()=>{
 const b=new UsageBook()
 for(const [id,cost] of [['a',1],['b',undefined],['c',4],['d',2],['e',3]] as const){b.start(meta,id,1);b.finish('s',undefined,cost,2)}
 assert.deepEqual(b.rows.map(r=>r.costUsd),[undefined,undefined,undefined,undefined,1])
})
test('aborting a session drains all queued rounds, without fabricating usage',()=>{
 const b=new UsageBook();b.start(meta,'a',1);b.start(meta,'b',2);b.abort('s',3)
 assert.deepEqual(b.rows.map(r=>r.status),['interrupted','interrupted']);assert.equal(b.rows[0].meter,undefined)
})
test('ACP cancels only the active request; queued requests that still execute are not cancelled',()=>{
 const b=new UsageBook();b.start({...meta,cli:'omp'},'a',1);b.start({...meta,cli:'omp'},'b',2)
 b.markInterrupted('s');b.finish('s',{input:1,output:1},undefined,3);b.finish('s',{input:2,output:2},undefined,4)
 assert.deepEqual(b.rows.map(r=>r.status),['interrupted','completed'])
})
