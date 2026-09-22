import {test} from 'node:test'
import assert from 'node:assert/strict'
test('source identity canonicalizes HTTPS URL but keeps distinct catalogs separate',async()=>{
 const {marketSourceIdentity}=await import('./pluginMarketSource.ts')
 const a=marketSourceIdentity('https://MARKET.example.com:443/plugins/registry.json')
 const b=marketSourceIdentity('https://market.example.com/plugins/registry.json')
 assert.deepEqual(a,b)
 assert.notEqual(a.id,marketSourceIdentity('https://market.example.com/other/registry.json').id)
 for(const url of ['http://market.example.com/registry.json','https://user:password@market.example.com/x','https://127.0.0.1/x','https://localhost/x','https://market.local/x','https://market.example.com/x?token=secret','https://market.example.com/x#fragment'])assert.throws(()=>marketSourceIdentity(url),url)
})
test('updates require exactly the original source; unknown provenance never inferred',async()=>{
 const {assertOriginalMarketSource}=await import('./pluginMarketSource.ts')
 assert.doesNotThrow(()=>assertOriginalMarketSource('source-a','source-a'))
 assert.throws(()=>assertOriginalMarketSource('source-a','source-b'),/来源/)
 assert.throws(()=>assertOriginalMarketSource(undefined,'source-a'),/来源/)
})

test('source store persists only validated entries and invalidates removed source generations',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'market-sources-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const {createMarketSourceStore}=await import('./pluginMarketSource.ts')
 const store=createMarketSourceStore(dir)
 const source=store.add('社区源','https://market.example.com/registry.json')
 assert.equal(createMarketSourceStore(dir).list()[0].url,source.url)
 assert.throws(()=>store.add('duplicate',source.url),/已经/)
 store.remove(source.id);assert.throws(()=>store.require(source.id),/来源/)
 const again=store.add('重新添加',source.url);assert.notEqual(again.generation,source.generation)
 assert.throws(()=>store.require(source.id,source.generation),/改变/)
 fs.writeFileSync(path.join(dir,'plugin-market-sources.json'),'bad JSON')
 assert.throws(()=>store.list(),/损坏/)
})
