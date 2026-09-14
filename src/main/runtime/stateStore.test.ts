import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRuntimeStateStore} from './stateStore.ts'
test('state survives a new store instance; invalid state is not silently reset',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-runtime-state-')),file=path.join(dir,'state.json')
 try{
  const s=createRuntimeStateStore(()=>file);assert.deepEqual(s.read(),{mode:'normal',stoppedPlugins:[]})
  s.write({mode:'eco',stoppedPlugins:['test-plugin']})
  assert.deepEqual(createRuntimeStateStore(()=>file).read(),{mode:'eco',stoppedPlugins:['test-plugin']})
  assert.throws(()=>s.write({mode:'normal',stoppedPlugins:['../bad']}),/invalid/)
  assert.equal(s.read().mode,'eco')
  fs.writeFileSync(file,'broken');assert.throws(()=>s.read(),/状态文件/)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('guard denial propagates; failed persistence does not report success',()=>{
 const s=createRuntimeStateStore(()=>{throw Error('guard denied')})
 assert.throws(()=>s.read(),/guard denied/);assert.throws(()=>s.write({mode:'normal',stoppedPlugins:[]}),/guard denied/)
})
