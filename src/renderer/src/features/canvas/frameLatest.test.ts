import {test} from 'node:test'
import assert from 'node:assert/strict'
import {frameLatest} from './frameLatest.ts'
function setup(){let id=0;const jobs=new Map<number,()=>void>(),out:number[]=[];const q=frameLatest<number>(x=>out.push(x),cb=>{jobs.set(++id,cb);return id},n=>{jobs.delete(n)});return {q,out,jobs,run(){const pending=[...jobs.values()];jobs.clear();pending.forEach(f=>f())}}}
test('many motion events commit latest position only once per frame',()=>{const s=setup();for(let i=0;i<100;i++)s.q.push(i);assert.equal(s.jobs.size,1);assert.deepEqual(s.out,[]);s.run();assert.deepEqual(s.out,[99])})
test('release flushes final position and cancels pending frame',()=>{const s=setup();s.q.push(5);s.q.flush();assert.deepEqual(s.out,[5]);assert.equal(s.jobs.size,0);s.run();s.q.flush();assert.deepEqual(s.out,[5])})
test('cancel discards obsolete motion and allows next gesture',()=>{const s=setup();s.q.push(2);s.q.cancel();s.run();assert.deepEqual(s.out,[]);s.q.push(3);s.run();assert.deepEqual(s.out,[3])})
test('a later animation frame can commit a new position',()=>{const s=setup();s.q.push(1);s.run();s.q.push(2);s.run();assert.deepEqual(s.out,[1,2])})
test('commit can enqueue a next frame without losing it',()=>{let id=0;const jobs=new Map<number,()=>void>(),out:number[]=[];const q=frameLatest<number>(x=>{out.push(x);if(x===1)q.push(2)},cb=>{jobs.set(++id,cb);return id},n=>{jobs.delete(n)});q.push(1);const f=jobs.get(1)!;jobs.delete(1);f();assert.equal(jobs.size,1);jobs.get(2)!();assert.deepEqual(out,[1,2])})
