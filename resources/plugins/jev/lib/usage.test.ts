import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {usageStore} from './usage.mjs'
test('daily reservation persists across restart and retains only safe metadata',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-usage-'));let day='2026-09-22'
 const options={dailyLimit:1,now:()=>new Date(day+'T12:00:00Z')}
 try{
  const s=usageStore(root,options),id=s.reserve('docs');s.finish(id,'success',{input_tokens:3,output_tokens:2,secret:'do not store'})
  const resumed=usageStore(root,options);assert.throws(()=>resumed.reserve('docs'),/上限/);assert.equal(resumed.snapshot().count,1)
  assert.equal(JSON.stringify(resumed.snapshot()).includes('secret'),false)
  day='2026-09-23';assert.ok(resumed.reserve('eval'));assert.equal(resumed.snapshot().count,1)
  assert.equal(resumed.snapshot().cost,null)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
