// Persistent real-stdio fixtures for manual WPS save/reopen acceptance.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {McpClient} from '../src/main/mcpClient.ts'
const root=process.cwd(),dir=fs.realpathSync(path.join(root,'docs/verification/plugin-marketplace/wps-office'))
const phase=process.argv[2]||'create', records=[]
for(const kind of ['excel','word','powerpoint']){
 const plugin=kind==='excel'?'/tmp/eas-excel-plugin-20260922-wps-office':path.join(root,'plugins-store',kind)
 const c=new McpClient({name:'wps-'+kind,command:process.execPath,args:[path.join(plugin,'server.mjs')],cwd:plugin,env:{EAS_PLUGIN_CONFIG:JSON.stringify({root:{path:dir,access:'read-write'}})}})
 try{
 await c.initialize('0.4.103')
 const call=async(name,args)=>{const r=await c.request('tools/call',{name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));const data=JSON.parse(r.content[0].text);records.push({name,args,result:data});return data}
 const file={excel:'wps-table.xlsx',word:'wps-document.docx',powerpoint:'wps-slides.pptx'}[kind]
 if(phase==='create'){
  if(kind==='excel'){
   let r=await call('excel_create',{path:file,sheets:[{name:'Sheet1',rows:[['Region','Amount','Units',null,'合计'],['East',10,1,null,{formula:'SUM(B2:B4)'}],['West',20,2],['East',30,3]]}]})
   r=await call('excel_chart',{path:file,sheet:'Sheet1',cell:'A7',chart:{type:'column',series:[{name:'金额 Amount',categories:'Sheet1!$A$2:$A$4',values:'Sheet1!$B$2:$B$4'},{name:'数量 Units',categories:'Sheet1!$A$2:$A$4',values:'Sheet1!$C$2:$C$4'}]},expectedSha256:r.sha256})
   await call('excel_pivot',{path:file,pivot:{source:'Sheet1!A1:C4',destination:'Sheet1!J1:M12',name:'RegionalTotals',rows:['Region'],data:[{field:'Amount',aggregate:'Sum'}]},expectedSha256:r.sha256})
  }else if(kind==='word')await call('word_create',{path:file,title:'WPS 文字 · 插件验收',paragraphs:[{text:'生成与格式',heading:1},{text:'这是一段待修订的验收正文。'},{text:'粗体验证 Bold',bold:true},{text:'斜体验证 Italic',italic:true}],tables:[{rows:[['分类','结果'],['中文表格','可编辑'],['保存重开','待验证']]}]})
  else await call('powerpoint_create',{path:file,slides:[{title:'WPS 演示 · 插件验收',body:'中文标题与正文\n创建 → 保存 → 插件编辑 → 重新打开'},{title:'第二页：往返验证',body:'原始正文：等待插件更新。'}]})
 }else if(phase==='edit'||phase==='roundtrip-edit'){
  fs.copyFileSync(path.join(dir,file),path.join(dir,(phase==='edit'?'before-first-edit-':'wps-saved-')+file))
  const r=await call(kind+'_read',{path:file}); if(phase==='roundtrip-edit'&&kind==='word'){assert.equal(r.paragraphs[2].tracked,true);assert.equal(r.paragraphs[2].deletedText,'这是一段待修订的验收正文。');assert.equal(r.tables[0].rows[1][0],'中文表格')} if(phase==='roundtrip-edit'&&kind==='powerpoint')assert.equal(r.slides.length,2)
  if(kind==='excel')await call('excel_update',{path:file,sheet:'Sheet1',cells:[{address:'B2',value:40}],expectedSha256:r.sha256})
  if(kind==='word')await call('word_revise',{path:file,paragraph:phase==='edit'?2:3,text:phase==='edit'?'修订后的正文：WPS 保存后，插件仍可安全编辑。':'粗体验证 Bold：WPS 往返通过',author:'Eas-Term 验收',expectedSha256:r.sha256})
  if(kind==='powerpoint')await call('powerpoint_edit',{path:file,slide:1,textIndex:1,text:phase==='edit'?'更新成功：WPS 保存后，插件编辑并保留两页布局。':'真实往返通过：WPS 保存 → 插件修改 → WPS 重开。',expectedSha256:r.sha256})
 }
 await call(kind+'_read',{path:file})
 if(kind==='excel')assert.equal((await call('excel_calculate',{path:file,sheet:'Sheet1',cell:'E2'})).value,phase==='create'?'60':'90')
 }finally{c.close();await c.exited}
}
fs.writeFileSync(path.join(dir,phase+'-mcp.json'),JSON.stringify(records,null,2)+'\n')
console.log('Real MCP phase passed:',phase)
