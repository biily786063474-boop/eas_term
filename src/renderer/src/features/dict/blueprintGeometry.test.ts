import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {blueprintRegions} from './blueprintGeometry.ts'
const blueprints=JSON.parse(fs.readFileSync('src/renderer/src/features/dict/blueprints.json','utf8')).blueprints
for(const bp of blueprints)test('positions describe every region: '+bp.id,()=>{
 const regions=blueprintRegions(bp)
 assert.equal(regions.length,bp.slots.length)
 for(const r of regions){assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=320&&r.y+r.h<=360);assert.ok(r.location.length>5);assert.ok(r.w>0&&r.h>0)}
 const nav=regions.find(r=>r.block==='导航栏');if(nav)assert.ok(nav.y<50)
 const tab=regions.find(r=>r.block==='标签栏');if(tab)assert.ok(tab.y>280)
 const side=regions.find(r=>r.block==='侧边栏');if(side)assert.ok(side.x<60)
})
test('dictionary removes secondary filters but retains search and blueprint region matching',()=>{
 const code=fs.readFileSync('src/renderer/src/features/dict/DictView.tsx','utf8')
 for(const stale of ['setCat2','setBlocks','dict-cats-2','dict-cats-blk'])assert.equal(code.includes(stale),false,stale)
 assert.ok(code.includes('searchTerms'));assert.ok(code.includes('BlueprintPanel'))
})
