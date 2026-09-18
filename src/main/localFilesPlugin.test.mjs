import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createFiles} from '../../plugins-store/local-files/lib/files.mjs'
import {McpClient} from './mcpClient.ts'
test('actual local-files stdio reads/writes granted temp files and rejects traversal/unguarded overwrite',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'files-connector-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const client=new McpClient({name:'files-test',command:process.execPath,args:[path.resolve('plugins-store/local-files/server.mjs')],cwd:root,env:{EAS_PLUGIN_CONFIG:JSON.stringify({root:{path:root,access:'read-write'}})}})
 try{
  await client.initialize('0.4.102');assert.equal((await client.listTools()).length,3)
  const call=(name,args)=>client.request('tools/call',{name,arguments:args})
  assert.equal((await call('files_write',{path:'note.txt',text:'真实文件测试'})).isError,undefined)
  assert.equal(fs.readFileSync(path.join(root,'note.txt'),'utf8'),'真实文件测试')
  const read=JSON.parse((await call('files_read',{path:'note.txt'})).content[0].text);assert.equal(read.text,'真实文件测试')
  assert.equal((await call('files_write',{path:'note.txt',text:'bad'})).isError,true)
  assert.equal((await call('files_write',{path:'note.txt',text:'updated',expectedSha256:read.sha256})).isError,undefined)
  assert.equal((await call('files_read',{path:'../outside'})).isError,true)
  const list=JSON.parse((await call('files_list',{})).content[0].text);assert.equal(list.entries[0].name,'note.txt')
 }finally{client.close();await client.exited}
})
test('readonly and links cannot be used to access or overwrite outside files',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'files-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const dir=path.join(root,'allowed');fs.mkdirSync(dir);fs.writeFileSync(path.join(root,'outside'),'keep');fs.symlinkSync(path.join(root,'outside'),path.join(dir,'link'))
 const files=createFiles({root:{path:dir,access:'read'}})
 assert.throws(()=>files.read({path:'link'}));assert.throws(()=>files.write({path:'new',text:'x'}));assert.equal(fs.readFileSync(path.join(root,'outside'),'utf8'),'keep')
})
