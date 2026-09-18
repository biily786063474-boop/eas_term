import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createDocument,readDocument,reviseDocument} from '../../plugins-store/word/lib/document.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {McpClient} from './mcpClient.ts'
import {packPlugin} from '../../scripts/pack-plugin.mjs'
import {execFileSync} from 'node:child_process'
import {deflateRawSync} from 'node:zlib'
function singleEntryZip(text){
 const name=Buffer.from('word/document.xml'),raw=Buffer.from(text),compressed=deflateRawSync(raw)
 const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(raw.length,22);header.writeUInt16LE(name.length,26)
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28)
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(header.length+name.length+compressed.length,16)
 return Buffer.concat([header,name,compressed,central,name,end])
}
test('Word rejects expanded XML over limit and entity declarations without resolving anything',async()=>{
 await assert.rejects(()=>readDocument(singleEntryZip('x'.repeat(8*1024*1024+1))),/展开体积超限/)
 await assert.rejects(()=>readDocument(singleEntryZip('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><w:document/>')),/实体声明/)
})
test('Word connector creates formatted DOCX, reads paragraphs and records a tracked replacement',async()=>{
 const original=await createDocument({title:'测试文档',paragraphs:[{text:'原段落',bold:true},{text:'第二段',heading:1}]})
 const parsed=await readDocument(original)
 assert.deepEqual(parsed.paragraphs.map(p=>p.text),['测试文档','原段落','第二段'])
 const revised=await reviseDocument(original,{paragraph:1,text:'修订段落',author:'验收用户'})
 const result=await readDocument(revised)
 assert.equal(result.paragraphs[1].text,'修订段落')
 assert.equal(result.paragraphs[1].deletedText,'原段落')
 assert.equal(result.paragraphs[1].tracked,true)
 await assert.rejects(()=>reviseDocument(revised,{paragraph:1,text:'再次修改',author:'用户'}),/修订/)
})
test('packed Word connector runs without npm dependencies, writes only granted DOCX and requires fresh revision hash',async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-word-test-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
 const root=path.join(tmp,'docs'),installed=path.join(tmp,'word');fs.mkdirSync(root);fs.mkdirSync(installed)
 const packed=packPlugin('plugins-store/word',{outRoot:path.join(tmp,'archives'),registrySchema:2})
 execFileSync('unzip',['-q',packed.zipPath,'-d',installed])
 assert.equal(fs.existsSync(path.join(installed,'node_modules')),false)
 const c=new McpClient({name:'word-test',command:process.execPath,args:[path.join(installed,'server.mjs')],cwd:installed,env:{PATH:process.env.PATH||'',EAS_PLUGIN_CONFIG:JSON.stringify({root:{path:root,access:'read-write'}})}})
 t.after(async()=>{c.close();await c.exited})
 await c.initialize('0.4.102');assert.equal((await c.listTools()).length,3)
 const call=(name,args)=>c.request('tools/call',{name,arguments:args})
 assert.ok(!(await call('word_create',{path:'test.docx',paragraphs:[{text:'原文'}]})).isError)
 const read=await call('word_read',{path:'test.docx'}),v=JSON.parse(read.content[0].text)
 assert.equal(v.paragraphs[0].text,'原文')
 assert.ok((await call('word_revise',{path:'test.docx',paragraph:0,text:'new',author:'user',expectedSha256:'stale'})).isError)
 assert.ok(!(await call('word_revise',{path:'test.docx',paragraph:0,text:'修订',author:'用户',expectedSha256:v.sha256})).isError)
 const revised=JSON.parse((await call('word_read',{path:'test.docx'})).content[0].text)
 assert.equal(revised.paragraphs[0].deletedText,'原文');assert.equal(revised.paragraphs[0].text,'修订')
 assert.ok((await call('word_create',{path:'../escape.docx',paragraphs:[{text:'forbidden'}]})).isError)
 assert.equal(fs.existsSync(path.join(tmp,'escape.docx')),false)
 fs.symlinkSync(path.join(root,'test.docx'),path.join(root,'link.docx'))
 assert.ok((await call('word_read',{path:'link.docx'})).isError)
})
test('Word connector rejects malformed input instead of dropping content',async()=>{
 await assert.rejects(()=>readDocument(Buffer.from('not zip')))
 await assert.rejects(()=>createDocument({paragraphs:[{text:'x',unsupported:true}]}),/参数/)
 const original=await createDocument({paragraphs:[{text:'原文'}]})
 await assert.rejects(()=>reviseDocument(original,{paragraph:9,text:'new',author:'user'}),/段落/)
 await assert.rejects(()=>reviseDocument(original,{paragraph:0,text:'new',author:''}),/作者/)
})
