import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createWorkerRequests} from './workerRequests.ts'
test('caller timeout does not release worker capacity or completion',async()=>{
 const r=createWorkerRequests<string>(1),owner={}
 const a=r.begin(1,owner,1)!;let completed=false;void a.completed.then(()=>completed=true)
 assert.equal(await a.result,null);assert.equal(completed,false);assert.equal(r.size,1);assert.equal(r.begin(2,owner,1),null)
 r.settle(1,owner,'late');await a.completed;assert.equal(r.size,0)
})
test('retired worker cannot settle replacement work',async()=>{
 const r=createWorkerRequests<string>(2),old={},next={};const a=r.begin(1,old,1000)!,b=r.begin(2,next,1000)!
 r.failOwner(old);assert.equal(await a.result,null);assert.equal(r.size,1)
 assert.equal(r.settle(2,old,'wrong'),false);r.settle(2,next,'ok');assert.equal(await b.result,'ok');await b.completed
})
