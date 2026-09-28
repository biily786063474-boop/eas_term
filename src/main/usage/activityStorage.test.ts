import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ActivityStore } from './activityStorage.ts'
test('atomic persistence survives restart and never stores payloads',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-activity-'));const file=path.join(dir,'activity.json')
 try{const s=new ActivityStore(file);s.book.record('term',Date.now());await s.flush();assert.equal(s.error,undefined)
 const next=new ActivityStore(file);assert.equal(next.book.data.days[0].counts.term,1);assert.equal(fs.statSync(file).mode&0o777,0o600)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('corrupt ledger is preserved and saving disabled',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-activity-'));const file=path.join(dir,'activity.json');fs.writeFileSync(file,'broken')
 try{const s=new ActivityStore(file);assert.ok(s.error);assert.equal(s.disabled,true);await s.flush();assert.equal(fs.readFileSync(file,'utf8'),'broken')}
 finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('write failure is surfaced without rejecting into product operation',async()=>{
 const s=new ActivityStore('/does-not-exist/eas-activity/ledger.json');await s.flush();assert.match(s.error!,/活动保存失败/)
})
