import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {preferenceStore} from './preferences.mjs'
import {createPolicy} from './policy.mjs'
test('v2 persists intent and selections but rejects credentials and unknown fields',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-prefs-'))
 try{
  const store=preferenceStore(dir);assert.equal(store.load(),undefined)
  const selected=createPolicy().snapshot().selected;selected.triage=false
  const prefs={version:2,enabledIntent:true,selected};store.save(prefs)
  assert.deepEqual(preferenceStore(dir).load(),prefs)
  assert.throws(()=>store.save({...prefs,apiKey:'never'}))
  assert.equal(fs.readdirSync(dir).length,1)
  fs.writeFileSync(path.join(dir,'preferences.json'),'invalid');assert.throws(()=>store.load(),/损坏/)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('legacy selections migrate paused without guessing authorization',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-legacy-'))
 try{
  const selected=createPolicy().snapshot().selected
  fs.writeFileSync(path.join(dir,'preferences.json'),JSON.stringify(selected))
  assert.deepEqual(preferenceStore(dir).load(),{version:2,enabledIntent:false,selected})
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('automation scopes persist explicitly and never inherit new projects',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-scope-'))
 try{
  const store=preferenceStore(dir),selected=createPolicy().snapshot().selected
  store.save({version:2,enabledIntent:true,selected,projectIds:['p1']})
  assert.deepEqual(store.load().projectIds,['p1'])
  assert.throws(()=>store.save({version:2,enabledIntent:true,selected,projectIds:['p1',2]}))
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
