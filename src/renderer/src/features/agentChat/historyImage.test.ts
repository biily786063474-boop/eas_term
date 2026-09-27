import test from 'node:test'
import assert from 'node:assert/strict'
import { historyImageSource } from './historyImage.ts'
test('saved paths reload through guarded reader; live thumbnails bypass IO',async()=>{
 let reads=0
 const read=async()=>{reads++;return {ok:true,dataUrl:'data:image/png;base64,eA=='}}
 assert.equal(await historyImageSource({path:'/a',url:'live'},read),'live');assert.equal(reads,0)
 assert.equal(await historyImageSource({path:'/a',url:''},read),'data:image/png;base64,eA==');assert.equal(reads,1)
 assert.equal(await historyImageSource({path:'/a',url:''},async()=>({ok:false,error:'denied'})),'')
})
