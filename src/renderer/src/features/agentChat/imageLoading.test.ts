import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createVisibleImage} from './imageLoading.ts'
test('离屏不加载，离屏释放且迟到响应不回填，重入可重试',async()=>{
 const updates:unknown[]=[];let resolve!:(v:any)=>void;let reads=0
 const loader=createVisibleImage(()=>{reads++;return new Promise(r=>resolve=r)},v=>updates.push(v))
 assert.equal(reads,0)
 loader.visible(true);assert.equal(reads,1)
 loader.visible(false);resolve({ok:true,url:'pixels'});await Promise.resolve()
 assert.deepEqual(updates.at(-1),{})
 loader.visible(true);assert.equal(reads,2)
 resolve({ok:true,url:'thumb'});await Promise.resolve()
 assert.deepEqual(updates.at(-1),{url:'thumb'})
 loader.dispose();assert.deepEqual(updates.at(-1),{})
})
