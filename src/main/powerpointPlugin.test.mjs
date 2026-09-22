import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {packPlugin} from '../../scripts/pack-plugin.mjs'
import {McpClient} from './mcpClient.ts'
import {createPresentation,readPresentation,editPresentation} from '../../plugins-store/powerpoint/lib/presentation.mjs'
test('create real PPTX and edit a text run preserving presentation order and other parts',async()=>{
 const bytes=await createPresentation({slides:[{title:'一 😀 & <二>',body:'中文正文'},{title:'第二页',body:'保留'}]})
 assert.equal(bytes.subarray(0,2).toString(),'PK')
 const read=await readPresentation(bytes);assert.equal(read.slides.length,2)
 assert.deepEqual(read.slides[0].texts,['一 😀 & <二>','中文正文'])
 const changed=await editPresentation(bytes,{slide:0,textIndex:1,text:'已改 🦋 & <保真>'})
 const after=await readPresentation(changed)
 assert.deepEqual(after.slides[0].texts,['一 😀 & <二>','已改 🦋 & <保真>'])
 assert.deepEqual(after.slides[1],read.slides[1])
 await assert.rejects(editPresentation(bytes,{slide:9,textIndex:0,text:'x'}),/幻灯片/)
 await assert.rejects(editPresentation(bytes,{slide:0,textIndex:99,text:'x'}),/文本/)
})
test('presentation limits and argument validation reject oversized inputs',async()=>{
 for(const slides of [[],Array(101).fill({title:'x'}),[{title:'x',unknown:1}],[{title:'x'.repeat(2001)}]]){
  await assert.rejects(createPresentation({slides}))
 }
})
test('packed PowerPoint runs offline through stdio with directory and overwrite guards',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-pptx-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
 const root=path.join(tmp,'docs'),installed=path.join(tmp,'installed');fs.mkdirSync(root);fs.mkdirSync(installed)
 const packed=packPlugin('plugins-store/powerpoint',{outRoot:path.join(tmp,'archives'),registrySchema:2})
 execFileSync('unzip',['-q',packed.zipPath,'-d',installed])
 const c=new McpClient({name:'pptx-test',command:process.execPath,args:[path.join(installed,'server.mjs')],cwd:installed,env:{PATH:process.env.PATH||'',EAS_PLUGIN_CONFIG:JSON.stringify({root:{path:root,access:'read-write'}})}})
 t.after(async()=>{c.close();await c.exited});await c.initialize('0.4.102')
 assert.equal((await c.listTools()).length,3)
 const call=(name,args)=>c.request('tools/call',{name,arguments:args})
 const slides=[{title:'标题',body:'正文'}]
 assert.ok(!(await call('powerpoint_create',{path:'a.pptx',slides})).isError)
 const first=JSON.parse((await call('powerpoint_read',{path:'a.pptx'})).content[0].text)
 const edit={path:'a.pptx',slide:0,textIndex:1,text:'改写'}
 assert.ok((await call('powerpoint_edit',{...edit,expectedSha256:'bad'})).isError)
 assert.ok(!(await call('powerpoint_edit',{...edit,expectedSha256:first.sha256})).isError)
 assert.equal(JSON.parse((await call('powerpoint_read',{path:'a.pptx'})).content[0].text).slides[0].texts[1],'改写')
 assert.ok((await call('powerpoint_create',{path:'../escape.pptx',slides})).isError)
 fs.symlinkSync(path.join(root,'a.pptx'),path.join(root,'link.pptx'))
 assert.ok((await call('powerpoint_read',{path:'link.pptx'})).isError)
})
async function modified(bytes,changes){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-pptx-xml-'))
 try{
  const zip=path.join(tmp,'test.pptx');fs.writeFileSync(zip,bytes)
  for(const [entry,text] of Object.entries(changes)){fs.mkdirSync(path.dirname(path.join(tmp,entry)),{recursive:true});fs.writeFileSync(path.join(tmp,entry),text);execFileSync('zip',['-q',zip,entry],{cwd:tmp})}
  return fs.readFileSync(zip)
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
function extract(bytes,entry){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-pptx-read-'))
 try{const zip=path.join(tmp,'test.pptx');fs.writeFileSync(zip,bytes);return execFileSync('unzip',['-p',zip,entry],{maxBuffer:40*1024*1024})}finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
test('reject active parts, external relationships, XML entities, nested text and expanded bombs',async()=>{
 const bytes=await createPresentation({slides:[{title:'x'}]})
 for(const [entry,value,pattern] of [
  ['ppt/vbaProject.bin','macro',/宏/],
  ['ppt/_rels/presentation.xml.rels','<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>',/外部/],
  ['ppt/slides/slide1.xml','<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x/>',/实体/],
  ['ppt/slides/slide1.xml','<a:t xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>x</a:t></a:t>',/嵌套/],
  ['payload.bin','x'.repeat(32*1024*1024),/展开超限/]
 ])await assert.rejects(readPresentation(await modified(bytes,{[entry]:value})),pattern)
})
test('edit preserves non-target entries and reads relationship order rather than filename order',async()=>{
 const bytes=await createPresentation({slides:[{title:'First'},{title:'Second'}]})
 const xml=extract(bytes,'ppt/presentation.xml').toString()
 const ids=xml.match(/<p:sldId\s[^>]*\/>/g);assert.equal(ids.length,2)
 const reversed=xml.replace(ids[0],'__FIRST__').replace(ids[1],ids[0]).replace('__FIRST__',ids[1])
 const source=await modified(bytes,{'ppt/presentation.xml':reversed,'ppt/media/owned.bin':Buffer.from([0,1,2,3])})
 assert.equal((await readPresentation(source)).slides[0].texts[0],'Second')
 const edited=await editPresentation(source,{slide:0,textIndex:0,text:'替换 & <保留>'})
 for(const entry of ['ppt/presentation.xml','ppt/slides/slide1.xml','ppt/media/owned.bin','ppt/slideMasters/slideMaster1.xml']){
  assert.deepEqual(extract(edited,entry),extract(source,entry),entry)
 }
 assert.equal((await readPresentation(edited)).slides[0].texts[0],'替换 & <保留>')
})
test('active relationship types cannot evade guards using renamed package parts',async()=>{
 const bytes=await createPresentation({slides:[{title:'x'}]})
 for(const attrs of [
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../media/renamed.bin"',
  'Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="../media/renamed.bin"',
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/a.png"'
 ]){
  const changed=await modified(bytes,{'ppt/slides/_rels/slide1.xml.rels':'<Relationships><Relationship Id="rId1" '+attrs+'/></Relationships>'})
  await assert.rejects(readPresentation(changed),/关系/)
 }
})
