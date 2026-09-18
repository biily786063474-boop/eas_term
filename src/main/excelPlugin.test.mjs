import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createWorkbook,readWorkbook,updateWorkbook} from '../../plugins-store/excel/lib/workbook.mjs'
test('real XLSX creation and reading preserve scalar cells and formulas without claiming calculation',async()=>{
 const buffer=await createWorkbook({sheets:[{name:'数据',rows:[['项目','数量'],['苹果',3],['梨',4],['合计',{formula:'SUM(B2:B3)'}]]}]})
 assert.ok(buffer.subarray(0,2).equals(Buffer.from('PK')))
 const data=await readWorkbook(buffer);assert.equal(data.sheets[0].name,'数据');assert.equal(data.sheets[0].rows[1][1],3)
 assert.equal(data.sheets[0].rows[3][1].formula,'SUM(B2:B3)');assert.equal(data.calculated,false)
})
test('cell updates preserve other values and reject out of bounds or executable formula inputs',async()=>{
 const buffer=await createWorkbook({sheets:[{name:'Sheet1',rows:[[1,2,'=SUM(A1:B1)']]}]})
 const changed=await updateWorkbook(buffer,{sheet:'Sheet1',cells:[{address:'B1',value:9}]})
 const data=await readWorkbook(changed);assert.deepEqual(data.sheets[0].rows[0],[1,9,'=SUM(A1:B1)'])
 for(const value of [{formula:'WEBSERVICE("https://example.com")'},{formula:'[evil.xlsx]Sheet1!A1'},{formula:'cmd|evil!A1'}])await assert.rejects(createWorkbook({sheets:[{name:'x',rows:[[value]]}]}),/公式/)
 await assert.rejects(updateWorkbook(buffer,{sheet:'Sheet1',cells:[{address:'A1048576',value:0}]}),/地址/)
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {McpClient} from './mcpClient.ts'
import {packPlugin} from '../../scripts/pack-plugin.mjs'
import {execFileSync} from 'node:child_process'
import {deflateRawSync} from 'node:zlib'
function singleEntryZip(text,entry='xl/workbook.xml'){
 const name=Buffer.from(entry),raw=Buffer.from(text),compressed=deflateRawSync(raw)
 const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(raw.length,22);header.writeUInt16LE(name.length,26)
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28)
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(header.length+name.length+compressed.length,16)
 return Buffer.concat([header,name,compressed,central,name,end])
}

test('absolute references are supported without enabling external formulas',async()=>{
 const bytes=await createWorkbook({sheets:[{name:'x',rows:[[2,{formula:'SUM($A$1:A1)'}]]}]})
 assert.equal((await readWorkbook(bytes)).sheets[0].rows[0][1].formula,'SUM($A$1:A1)')
})
test('XML entities and expanded archive limits fail closed',async()=>{
 await assert.rejects(readWorkbook(singleEntryZip('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x/>')),/实体/)
 await assert.rejects(readWorkbook(singleEntryZip('x'.repeat(32*1024*1024+1))),/展开超限/)
})
test('packed Excel executes without installed dependencies and enforces directory and revision guards',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-excel-test-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
 const root=path.join(tmp,'docs'),installed=path.join(tmp,'excel');fs.mkdirSync(root);fs.mkdirSync(installed)
 const packed=packPlugin('plugins-store/excel',{outRoot:path.join(tmp,'archives'),registrySchema:2})
 execFileSync('unzip',['-q',packed.zipPath,'-d',installed])
 assert.equal(fs.existsSync(path.join(installed,'node_modules')),false)
 const c=new McpClient({name:'excel-test',command:process.execPath,args:[path.join(installed,'server.mjs')],cwd:installed,env:{PATH:process.env.PATH||'',EAS_PLUGIN_CONFIG:JSON.stringify({root:{path:root,access:'read-write'}})}})
 t.after(async()=>{c.close();await c.exited});await c.initialize('0.4.102');assert.equal((await c.listTools()).length,3)
 const call=(name,args)=>c.request('tools/call',{name,arguments:args})
 const sheets=[{name:'x',rows:[[1,2]]}]
 assert.ok(!(await call('excel_create',{path:'test.xlsx',sheets})).isError)
 const v=JSON.parse((await call('excel_read',{path:'test.xlsx'})).content[0].text)
 assert.equal(v.sheets[0].rows[0][0],1)
 const changes={path:'test.xlsx',sheet:'x',cells:[{address:'A1',value:9}]}
 assert.ok((await call('excel_update',{...changes,expectedSha256:'stale'})).isError)
 assert.ok(!(await call('excel_update',{...changes,expectedSha256:v.sha256})).isError)
 assert.equal(JSON.parse((await call('excel_read',{path:'test.xlsx'})).content[0].text).sheets[0].rows[0][0],9)
 assert.ok((await call('excel_create',{path:'../escape.xlsx',sheets})).isError)
 assert.equal(fs.existsSync(path.join(tmp,'escape.xlsx')),false)
 fs.symlinkSync(path.join(root,'test.xlsx'),path.join(root,'link.xlsx'))
 assert.ok((await call('excel_read',{path:'link.xlsx'})).isError)
})

test('invalid worksheet structures and complex edits reject before library parsing',async()=>{

 const original=await createWorkbook({sheets:[{name:'x',rows:[[1]]}]})
 async function change(entry,xml){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'excel-xml-'))
 try{const zip=path.join(dir,'test.xlsx');fs.writeFileSync(zip,original);fs.mkdirSync(path.dirname(path.join(dir,entry)),{recursive:true});fs.writeFileSync(path.join(dir,entry),xml);execFileSync('zip',['-q',zip,entry],{cwd:dir});return fs.readFileSync(zip)}finally{fs.rmSync(dir,{recursive:true,force:true})}
 }
 await assert.rejects(readWorkbook(await change('xl/worksheets/sheet1.xml','<worksheet><row r="1"><c r="XFD1048576"/></row></worksheet>')),/地址/)
 await assert.rejects(readWorkbook(await change('xl/_rels/workbook.xml.rels','<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>')),/外部/)
 await assert.rejects(readWorkbook(await change('xl/vbaProject.bin','macro')),/宏/)
 await assert.rejects(updateWorkbook(await change('xl/charts/chart1.xml','<chart/>'),{sheet:'x',cells:[{address:'A1',value:2}]}),/复杂工作簿/)
})
