// Real packed stdio connector; isolated temporary docs, never user workbooks.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {McpClient} from '../src/main/mcpClient.ts'
import {packPlugin} from './pack-plugin.mjs'
const source=process.argv[2]
if(!source||!path.isAbsolute(source))throw Error('Pass staging package absolute path')
const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'excel-native-plugin-')))
let c
try{
 const staged=path.join(tmp,'excel'),installed=path.join(tmp,'installed'),docs=path.join(tmp,'docs')
 fs.cpSync(source,staged,{recursive:true});fs.mkdirSync(installed);fs.mkdirSync(docs)
 const packed=packPlugin(staged,{registrySchema:2,outRoot:path.join(tmp,'archives')})
 assert.ok(packed.entry.size<25*1024*1024,'must fit existing market size limit')
 execFileSync('unzip',['-q',packed.zipPath,'-d',installed])
 c=new McpClient({name:'excel-native-verify',command:process.execPath,args:[path.join(installed,'server.mjs')],cwd:installed,env:{EAS_PLUGIN_CONFIG:JSON.stringify({root:{path:docs,access:'read-write'}})}})
 await c.initialize('0.4.102');assert.equal((await c.listTools()).length,6)
 const raw=(name,args)=>c.request('tools/call',{name,arguments:args})
 const call=async(name,args)=>{const r=await raw(name,args);assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text)}
 const sheets=[{name:'Sheet1',rows:[['Region','Amount',null,{formula:'SUM(B2:B3)'}],['East',10],['West',20]]}]
 let result=await call('excel_create',{path:'test.xlsx',sheets})
 assert.equal((await call('excel_calculate',{path:'test.xlsx',sheet:'Sheet1',cell:'D1'})).value,'30')
 result=await call('excel_chart',{path:'test.xlsx',sheet:'Sheet1',cell:'F2',chart:{type:'column',series:[{name:'金额 & Amount',categories:'Sheet1!$A$2:$A$3',values:'Sheet1!$B$2:$B$3'}]},expectedSha256:result.sha256})
 result=await call('excel_pivot',{path:'test.xlsx',pivot:{source:'Sheet1!A1:B3',destination:'Sheet1!J1:M12',name:'Totals',rows:['Region'],data:[{field:'Amount',aggregate:'Sum'}]},expectedSha256:result.sha256})
 assert.match(result.note,/刷新/)
 const before=fs.readFileSync(path.join(docs,'test.xlsx'))
 assert.ok((await raw('excel_update',{path:'test.xlsx',sheet:'Sheet1',cells:[{address:'B2',value:40}],expectedSha256:'stale'})).isError)
 assert.deepEqual(fs.readFileSync(path.join(docs,'test.xlsx')),before)
 result=await call('excel_update',{path:'test.xlsx',sheet:'Sheet1',cells:[{address:'B2',value:40}],expectedSha256:result.sha256})
 assert.equal((await call('excel_calculate',{path:'test.xlsx',sheet:'Sheet1',cell:'D1'})).value,'60')
 const read=await call('excel_read',{path:'test.xlsx'});assert.equal(read.sheets[0].rows[1][1],40);assert.equal(read.sha256,result.sha256)
 assert.ok((await raw('excel_create',{path:'../escape.xlsx',sheets})).isError)
 assert.ok((await raw('excel_create',{path:'evil.xlsx',sheets:[{name:'s',rows:[[{formula:'WEBSERVICE("https://example.com")'}]]}]})).isError)
 assert.equal(fs.existsSync(path.join(docs,'evil.xlsx')),false)
 fs.symlinkSync(path.join(docs,'test.xlsx'),path.join(docs,'link.xlsx'))
 assert.ok((await raw('excel_read',{path:'link.xlsx'})).isError)
 const snapshot=fs.readFileSync(path.join(docs,'test.xlsx'))
 c.close();await c.exited
 c=new McpClient({name:'excel-native-readonly',command:process.execPath,args:[path.join(installed,'server.mjs')],cwd:installed,env:{EAS_PLUGIN_CONFIG:JSON.stringify({root:{path:docs,access:'read'}})}})
 await c.initialize('0.4.102')
 assert.ok(!(await raw('excel_read',{path:'test.xlsx'})).isError)
 assert.ok((await raw('excel_update',{path:'test.xlsx',sheet:'Sheet1',cells:[{address:'B2',value:90}],expectedSha256:result.sha256})).isError)
 assert.deepEqual(fs.readFileSync(path.join(docs,'test.xlsx')),snapshot)
 const members=execFileSync('unzip',['-Z1',path.join(docs,'test.xlsx')],{encoding:'utf8'})
 assert.match(members,/xl\/charts\/chart1.xml/);assert.match(members,/xl\/pivotTables\/pivotTable1.xml/)
 console.log(JSON.stringify({passed:true,packedStdio:true,tools:6,archiveBytes:packed.entry.size,create:true,read:true,update:true,calculate:true,chart:true,pivot:true,revisionGuard:true,pathGuard:true,unsafeFormulaGuard:true,symlinkGuard:true,readOnlyGuard:true,appHostVerified:false,excelVisualVerified:false,platform:process.platform,arch:process.arch},null,2))
}finally{if(c){c.close();await c.exited}fs.rmSync(tmp,{recursive:true,force:true})}
