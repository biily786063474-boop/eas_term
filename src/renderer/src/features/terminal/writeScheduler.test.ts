import test from 'node:test'
import assert from 'node:assert/strict'
import { createWriteScheduler } from './writeScheduler.ts'
test('background drains without animation frames, preserving order and one in-flight write',()=>{
 let background=true;let done:(()=>void)|undefined;const writes:string[]=[]
 const q=createWriteScheduler({background:()=>background,frame:()=>1,cancelFrame:()=>{},write:(s,cb)=>{writes.push(s);done=cb}})
 q.push('a');q.push('b');q.push('c');assert.deepEqual(writes,['a']);done!();assert.deepEqual(writes,['a','bc']);done!()
 background=false;q.push('d');assert.equal(writes.length,2);background=true;q.visibilityChanged();assert.deepEqual(writes,['a','bc','d'])
 q.dispose();done!();assert.equal(writes.join(''),'abcd')
})
test('bounded chunks and callback draining work across many batches',()=>{
 const callbacks:(()=>void)[]=[];let result=''
 const q=createWriteScheduler({background:()=>true,frame:()=>1,cancelFrame:()=>{},write:(s,cb)=>{assert.ok(s.length<=65536);result+=s;callbacks.push(cb)}})
 const input='x'.repeat(300000);q.push(input)
 while(callbacks.length)callbacks.shift()!()
 assert.equal(result,input);q.dispose();q.push('discard after disposal');assert.equal(result,input)
})
test('foreground coalesces and cancels pending frame on disposal',()=>{
 let tick=()=>{};let cancelled=0;let result=''
 const q=createWriteScheduler({background:()=>false,frame:cb=>{tick=cb;return 1},cancelFrame:()=>cancelled++,write:(s,cb)=>{result+=s;cb()}})
 q.push('a');q.push('b');assert.equal(result,'');tick();assert.equal(result,'ab');q.push('c');q.dispose();tick();assert.equal(result,'ab');assert.equal(cancelled,1)
})
