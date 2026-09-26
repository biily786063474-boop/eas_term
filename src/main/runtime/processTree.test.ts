import {test} from 'node:test'
import assert from 'node:assert/strict'
import {aggregateProcessTree,createProcessTreeReader} from './processTree.ts'

test('counts root, CLI children and plugin grandchildren once; excludes unrelated and sampler subtree',()=>{
 const raw='10 1 100\n12 10 200\n13 12 300\n20 1 900\n30 10 50\n31 30 25'
 assert.deepEqual(aggregateProcessTree(raw,10,7,1024,30),{sampledAt:7,scope:'app-process-tree',processCount:3,residentBytes:600*1024})
 assert.equal(aggregateProcessTree('10 1 1024\n12 10 2048',10,7,1)?.residentBytes,3072)
})
test('unknown/malformed/ambiguous snapshots never become zero or leak raw data',()=>{
 for(const raw of ['', '1 0 10','10 1 -5','10 1 1\n10 1 1','10 1 2 secret','10 1 9007199254740992','10 11 1\n11 10 2'])
  assert.equal(aggregateProcessTree(raw,10,1,1024),null,raw)
})
test('reader coalesces concurrent requests and caches success and failure for five seconds',async()=>{
 let time=0,calls=0,fail=false
 const read=createProcessTreeReader(()=>time,10,async()=>{calls++;await Promise.resolve();if(fail)throw Error('secret');return {raw:'10 1 100',scale:1024}})
 const [a,b]=await Promise.all([read(),read()]);assert.equal(calls,1);assert.deepEqual(a,b)
 a!.residentBytes=0;assert.equal((await read())?.residentBytes,102400)
 time=5000;fail=true;assert.equal(await read(),null);assert.equal(await read(),null);assert.equal(calls,2)
 time=10000;fail=false;assert.equal((await read())?.processCount,1);assert.equal(calls,3)
})

test('synchronous collector failure also expires; unsupported probe cannot pin the cache forever',async()=>{
 let time=0,calls=0
 const reader=createProcessTreeReader(()=>time,10,()=>{if(++calls===1)throw Error('unavailable');return Promise.resolve({raw:'10 1 1',scale:1})})
 assert.equal(await reader(),null);time=5000
 assert.equal((await reader())?.residentBytes,1);assert.equal(calls,2)
})
