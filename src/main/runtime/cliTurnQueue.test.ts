import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCliTurnQueue} from './cliTurnQueue.ts'
function fixture(){
 let now=0;let next=0;const timers=new Map<number,{at:number;fn:()=>void}>();const started:string[]=[];const cancelled:string[]=[]
 const q=createCliTurnQueue({now:()=>now,setTimer:(fn,ms)=>{const id=++next;timers.set(id,{at:now+ms,fn});return id},clearTimer:id=>{timers.delete(id as number)}})
 const add=(key:string,projectId=key,sessionId=key)=>q.enqueue({key,projectId,sessionId,start:()=>{started.push(key)},cancelRunning:()=>{cancelled.push(key)}})
 const advance=(ms:number)=>{now+=ms;for(let i=0;i<100;i++){const due=[...timers].find(([,t])=>t.at<=now);if(!due)return;timers.delete(due[0]);due[1].fn()}throw Error('timer spin')}
 return {q,add,advance,started,cancelled,timers}
}
test('two active turns, actual start interval, completion idempotence',()=>{
 const {q,add,advance,started}=fixture();add('a');add('b');add('c');assert.deepEqual(started,['a']);advance(999);assert.equal(started.length,1);advance(1);assert.deepEqual(started,['a','b']);advance(1000);assert.equal(started.length,2);q.finish('a');assert.deepEqual(started,['a','b','c']);q.finish('a');assert.equal(q.snapshot().filter(x=>x.state==='running').length,2)
})
test('cancel queued never starts and running cancel retains capacity',()=>{
 const {q,add,advance,started,cancelled}=fixture();add('a');add('b');add('c');advance(1000);q.cancel('a');q.cancel('c');advance(1000);assert.deepEqual(cancelled,['a']);assert.deepEqual(started,['a','b']);assert.equal(q.snapshot()[0].state,'cancel-requested')
})
test('round robin projects and FIFO within project',()=>{
 const {q,add,advance,started}=fixture();q.setLimit(1);add('a1','a');add('a2','a');add('b1','b');advance(1000);q.finish('a1');assert.deepEqual(started,['a1','b1']);advance(1000);q.finish('b1');assert.deepEqual(started,['a1','b1','a2'])
})
test('limits update without interrupt and spacing still applies',()=>{
 const {q,add,advance,started}=fixture();add('a');add('b');add('c');advance(1000);q.setLimit(1);q.finish('a');advance(1000);assert.equal(started.length,2);q.finish('b');assert.equal(started.length,3);assert.throws(()=>q.setLimit(0));assert.throws(()=>q.setLimit(1.5))
})
test('bounded queue, unique session, dispose clears timers',()=>{
 const {q,add,timers}=fixture();add('a');assert.equal(add('a').ok,false);add('b','b','s');assert.equal(add('c','c','s').ok,false);for(let i=0;i<127;i++)add('x'+i);assert.equal(add('overflow').ok,false);q.dispose();assert.equal(timers.size,0);assert.equal(add('late').ok,false)
})
test('start exception releases slot and notifies failure',()=>{
 const {q,advance,add,started}=fixture();let failed=false;q.enqueue({key:'bad',sessionId:'bad',projectId:'bad',start:()=>{throw Error('bad')},cancelRunning(){},failed:()=>{failed=true}});add('good');advance(1000);assert.equal(failed,true);assert.deepEqual(started,['good'])
})
test('three projects rotate by least recently served, not alternating first two',()=>{
 const {q,add,advance,started}=fixture();q.setLimit(1);add('a1','a');add('a2','a');add('a3','a');add('b1','b');add('b2','b');add('c1','c')
 advance(1000);q.finish('a1');advance(1000);q.finish('b1');assert.deepEqual(started,['a1','b1','c1'])
})
test('synchronous preparation cannot consume dispatch spacing',()=>{
 let now=0;let scheduledAt=0;let next:(()=>void)|undefined;const starts:number[]=[]
 const q=createCliTurnQueue({now:()=>now,setTimer:(fn,ms)=>{next=fn;scheduledAt=now+ms;return 1},clearTimer:()=>{next=undefined}})
 q.enqueue({key:'a',sessionId:'a',projectId:'a',start(){now+=900;starts.push(now)},cancelRunning(){}})
 q.enqueue({key:'b',sessionId:'b',projectId:'b',start(){starts.push(now)},cancelRunning(){}})
 assert.equal(scheduledAt,1900);now=scheduledAt;next?.();assert.equal(starts[1]-starts[0],1000)
})
