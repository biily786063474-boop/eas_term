import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const routes=JSON.parse(fs.readFileSync(new URL('./browserRoutes.json',import.meta.url)))
test('route ids unique and only explicit HTTP(S) entries navigable',()=>{
 assert.equal(new Set(routes.sites.map(s=>s.id)).size,routes.sites.length)
 for(const s of routes.sites){
 assert.ok(routes.categories.some(c=>c.id===s.category))
 assert.ok(s.intents.length)
 if(s.status==='pending'){assert.equal(s.url,null);continue}
 const u=new URL(s.url);assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'')
 }
})
test('publishing intent uses creator entry and does not authorize publication',()=>{
 const x=routes.sites.find(s=>s.id==='xiaohongshu')
 assert.equal(x.url,'https://creator.xiaohongshu.com/')
 assert.ok(x.intents.includes('发布小红书笔记'))
 assert.equal(routes.policy.openingIsPublishingConsent,false)
 assert.equal(routes.sites.find(s=>s.id==='short-video-assistant').status,'pending')
})
