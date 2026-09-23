import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {preferenceStore} from './preferences.mjs'
import {createPolicy} from './policy.mjs'
test('only selections survive restart; consent and credentials never persist',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-prefs-'))
 try{
  const store=preferenceStore(dir);assert.equal(store.load(),undefined)
  const selected=createPolicy().snapshot().selected;selected.triage=false;store.save(selected)
  assert.deepEqual(preferenceStore(dir).load(),selected)
  assert.throws(()=>store.save({...selected,apiKey:'never'}))
  assert.equal(fs.readdirSync(dir).length,1)
  fs.writeFileSync(path.join(dir,'preferences.json'),'invalid');assert.throws(()=>store.load(),/损坏/)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
