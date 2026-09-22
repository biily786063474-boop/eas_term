// Verify the compiled one-shot binary, not a mock/library-only invocation.
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createWorkbook} from './excel-connector/workbook.mjs'
const binary=process.argv[2];if(!binary||!path.isAbsolute(binary))throw Error('Pass absolute development engine binary path')
const out='docs/verification/plugin-marketplace/excel-engine';fs.mkdirSync(out,{recursive:true})
function call(operation,workbook,args={}){
 const p=spawnSync(binary,[],{input:JSON.stringify({operation,workbook:workbook.toString('base64'),...args}),encoding:'utf8',timeout:20000,maxBuffer:12*1024*1024,env:{}})
 if(p.status!==0)throw Error(p.stderr||String(p.error));return JSON.parse(p.stdout)
}
let workbook=await createWorkbook({sheets:[{name:'Sheet1',rows:[['Region','Amount',null,{formula:'SUM(B2:B3)'}],['East',10],['West',20]]}]})
assert.equal(call('calculate',workbook,{sheet:'Sheet1',cell:'D1'}).value,'30')
workbook=Buffer.from(call('chart',workbook,{sheet:'Sheet1',cell:'F2',chart:{type:'column',categories:'Sheet1!$A$2:$A$3',values:'Sheet1!$B$2:$B$3',name:'Amount'}}).workbook,'base64')
const pivot=call('pivot',workbook,{pivot:{source:'Sheet1!A1:B3',destination:'Sheet1!J1:M12',name:'RegionTotals',rows:['Region'],data:[{field:'Amount',aggregate:'Sum'}]}})
assert.match(pivot.note,/刷新/);workbook=Buffer.from(pivot.workbook,'base64')
workbook=Buffer.from(call('update',workbook,{sheet:'Sheet1',changes:[{cell:'B2',value:40}]}).workbook,'base64')
assert.equal(call('calculate',workbook,{sheet:'Sheet1',cell:'D1'}).value,'60')
const bad=spawnSync(binary,[],{input:'{"path":"/etc/passwd"}',encoding:'utf8',timeout:20000,env:{}})
assert.equal(bad.status,1);assert.equal(bad.stdout,'')
fs.writeFileSync(out+'/native-analytics.xlsx',workbook)
fs.writeFileSync(out+'/process-result.json',JSON.stringify({passed:true,checks:['calculate','native chart','native pivot with refresh warning','update analytics workbook','recalculate dependency','reject path with no output'],actualBinary:true,excelVisualVerified:false,pluginIntegrated:false},null,2)+'\n')
console.log('Actual Excel engine subprocess: 6 checks passed; not plugin or Excel visual acceptance')
