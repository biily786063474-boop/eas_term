import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeCapabilitySnapshot } from './capabilitySnapshot.ts'
test('会话配置独立且不可变，别的会话及同会话更新不覆盖已发出的快照',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'能力 空格-'))
 try {
  const a=writeCapabilitySnapshot(root,'a',{canvas:{command:'one'}})
  const b=writeCapabilitySnapshot(root,'b',{canvas:{command:'two'}})
  const next=writeCapabilitySnapshot(root,'a',{canvas:{command:'three'}})
  assert.notEqual(a,b);assert.notEqual(a,next)
  assert.equal(JSON.parse(fs.readFileSync(a,'utf8')).mcpServers.canvas.command,'one')
  assert.equal(writeCapabilitySnapshot(root,'a',{canvas:{command:'one'}}),a)
  if(process.platform!=='win32')assert.equal(fs.statSync(a).mode&0o777,0o600)
 } finally {fs.rmSync(root,{recursive:true,force:true})}
})
test('session key 不成为路径，也不能穿越配置目录',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cap-snapshot-'))
 try {const file=writeCapabilitySnapshot(root,'../../elsewhere',{x:{command:'node'}});assert.equal(path.dirname(file),root)}
 finally{fs.rmSync(root,{recursive:true,force:true})}
})
