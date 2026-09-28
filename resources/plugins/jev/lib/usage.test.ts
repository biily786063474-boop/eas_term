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
test('day snapshot resets without another request and estimates only known successful tokens',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-usage-day-'));let day='2026-09-28'
 try{
  const s=usageStore(root,{now:()=>new Date(day+'T00:00:00Z')})
  s.finish(s.reserve('custom'),'success',{input_tokens:1000000,output_tokens:20})
  s.finish(s.reserve('custom'),'failed')
  assert.equal(s.snapshot().estimatedUsd,.042);assert.equal(s.snapshot().unknownCostCalls,1)
  day='2026-09-29';assert.equal(s.snapshot().count,0);assert.equal(s.snapshot().estimatedUsd,0)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
