import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createFiles} from '../../plugins-store/excel/lib/files.mjs'
import {createConnector,tools} from './connector.mjs'
test('native connector exposes six tools and validates arguments before engine access',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excel-connector-'))
 try{
  const call=createConnector('/nonexistent',createFiles({root:{path:root,access:'read-write'}}))
  assert.deepEqual(tools.map(t=>t.name),['excel_read','excel_create','excel_update','excel_calculate','excel_chart','excel_pivot'])
  await assert.rejects(call('excel_calculate',{path:'a.xlsx',sheet:'s',cell:'A1',binary:'/tmp/x'}),/参数/)
  await assert.rejects(call('excel_chart',{path:'a.xlsx',sheet:'s',cell:'A1',chart:{}}),/参数/)
  await assert.rejects(call('excel_update',{path:'../escape.xlsx',sheet:'s',cells:[],expectedSha256:'x'}),/路径/)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
