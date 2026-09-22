// Development verifier: stage a copy, never modify the installed plugin or app.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {runEngine} from './excel-engine/worker.mjs'
import {createWorkbook} from './excel-connector/workbook.mjs'
const binary=process.argv[2]
if(!binary||!path.isAbsolute(binary))throw Error('Pass absolute development binary')
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'excel-worker-real-')))
try{
 const key=process.platform+'-'+process.arch,b=await fs.readFile(binary)
 await fs.mkdir(path.join(root,'bin'))
 await fs.writeFile(path.join(root,'bin','excel-engine-'+key+(process.platform==='win32'?'.exe':'')),b,{mode:0o700})
 await fs.writeFile(path.join(root,'bin','integrity.json'),JSON.stringify({[key]:{size:b.length,sha256:createHash('sha256').update(b).digest('hex')}}))
 let workbook=await createWorkbook({sheets:[{name:'Sheet1',rows:[['Region','Amount',null,{formula:'SUM(B2:B3)'}],['East',10],['West',20]]}]})
 const call=(operation,args={})=>runEngine(root,{operation,workbook:workbook.toString('base64'),...args})
 assert.equal((await call('calculate',{sheet:'Sheet1',cell:'D1'})).value,'30')
 workbook=Buffer.from((await call('chart',{sheet:'Sheet1',cell:'F2',chart:{type:'column',categories:'Sheet1!$A$2:$A$3',values:'Sheet1!$B$2:$B$3',name:'Amount'}})).workbook,'base64')
 const pivot=await call('pivot',{pivot:{source:'Sheet1!A1:B3',destination:'Sheet1!J1:M12',name:'Totals',rows:['Region'],data:[{field:'Amount',aggregate:'Sum'}]}})
 assert.match(pivot.note,/刷新/);workbook=Buffer.from(pivot.workbook,'base64')
 workbook=Buffer.from((await call('update',{sheet:'Sheet1',changes:[{cell:'B2',value:40}]})).workbook,'base64')
 assert.equal((await call('calculate',{sheet:'Sheet1',cell:'D1'})).value,'60')
 await assert.rejects(call('calculate',{path:'/etc/passwd'}),/failed/)
 const result={passed:true,checks:6,actualBinary:true,parentAdapter:true,platform:process.platform,arch:process.arch,pluginIntegrated:false,excelVisualVerified:false}
 await fs.writeFile('docs/verification/plugin-marketplace/excel-engine/worker-result.json',JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result))
}finally{await fs.rm(root,{recursive:true,force:true})}
