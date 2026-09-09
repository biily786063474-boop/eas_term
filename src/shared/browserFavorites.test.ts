import test from 'node:test'
import assert from 'node:assert/strict'
import {freshFavorites,applyFavoriteChange,parseFavoriteRoute,safeSiteUrl,validateFavorites,mergeFavoriteCatalog} from './browserFavorites.ts'
test('defaults and stable custom CRUD preserve all websites',()=>{
 let s=freshFavorites();assert.equal(s.folders.length,5)
 s=applyFavoriteChange(s,{type:'folder',name:'我的资料',sticker:'★'},'f1')
 s=applyFavoriteChange(s,{type:'save',folderId:'f1',name:'页面',url:'https://example.com'},'s1')
 assert.equal(s.sites.at(-1)?.url,'https://example.com/')
 s=applyFavoriteChange(s,{type:'folder',id:'f1',name:'新名称',sticker:'☁'},'unused')
 assert.equal(s.sites.at(-1)?.folderId,'f1')
 assert.throws(()=>applyFavoriteChange(s,{type:'save',folderId:'f1',name:'页面',url:'https://example.com'},'s2'),/已收藏/)
 assert.throws(()=>applyFavoriteChange(s,{type:'folder',name:'新名称',sticker:'★'},'f2'),/同名/)
})
test('URLs and deep links cannot execute scripts or silently submit',()=>{
 for(const u of ['javascript:alert(1)','file:///etc/passwd','https://user:pass@example.com'])assert.throws(()=>safeSiteUrl(u))
 assert.deepEqual(parseFavoriteRoute('eas-favorites://home?folder=media'),{folder:'media',save:false,url:'',name:''})
 assert.equal(parseFavoriteRoute('https://example.com'),null)
 assert.throws(()=>parseFavoriteRoute('eas-favorites://save?url=javascript:alert(1)'))
 assert.equal(parseFavoriteRoute('eas-favorites://save?url=https%3A%2F%2Fexample.com')?.save,true)
})
test('unknown folder, malformed input and quotas rejected',()=>{
 const s=freshFavorites()
 assert.throws(()=>applyFavoriteChange(s,{type:'save',folderId:'missing',name:'x',url:'https://example.com'},'x'))
 assert.throws(()=>applyFavoriteChange(s,{type:'folder',name:' ',sticker:'★'},'x'))
 assert.throws(()=>applyFavoriteChange(s,{type:'folder',name:'ok',sticker:'<script>'},'x'))
})

test('disk validation roundtrip and unsafe preview paths',()=>{
 const s=freshFavorites();assert.deepEqual(validateFavorites(JSON.parse(JSON.stringify(s))),s)
 s.sites[0].preview='../secret.jpg';assert.throws(()=>validateFavorites(s))
 delete s.sites[0].preview;s.sites[0].url='javascript:alert(1)';assert.throws(()=>validateFavorites(s))
 assert.throws(()=>validateFavorites({version:1,folders:[null],sites:[]}))
})
test('catalog upgrades only append new presets and preserve edits and intentional removals',()=>{
 const old=freshFavorites();old.folders[0].name='我的动效';old.sites=old.sites.filter(s=>s.id!=='react-bits')
 const next=freshFavorites();next.sites.push({id:'future-site',folderId:old.folders[0].id,name:'New',url:'https://example.org/',description:''})
 const upgraded=mergeFavoriteCatalog(old,next)
 assert.equal(upgraded.folders[0].name,'我的动效')
 assert.ok(upgraded.sites.some(s=>s.id==='future-site'))
 assert.equal(upgraded.sites.some(s=>s.id==='react-bits'),false)
 assert.deepEqual(mergeFavoriteCatalog(upgraded,next),upgraded)
})
