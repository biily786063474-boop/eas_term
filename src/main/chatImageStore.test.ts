import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createChatImageStore} from './chatImageStore.ts'
import {safeChatImages} from '../shared/chatImages.ts'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
test('图片落盘为内容寻址引用，重复不复制，历史与传输无Base64',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-image-test-'))
 try{
  const store=createChatImageStore(name=>({ok:true,path:path.join(dir,name)}))
  const im={mimeType:'image/png',url:'data:image/png;base64,'+png}
  const a=store.persist([im,im]);assert.equal(a.images.length,1)
  assert.match(a.images[0].url,/^eas-chat-image:[a-f0-9]{64}\.png$/)
  assert.equal(JSON.stringify(a).includes(png),false)
  assert.equal(store.persist([im]).images[0].url,a.images[0].url)
  assert.equal(fs.readdirSync(dir).length,1)
  assert.equal(store.read(a.images[0]).toString('base64'),png)
  assert.equal(safeChatImages(a.images).length,1)
  assert.equal(safeChatImages([{...im,url:'eas-chat-image:../../secret'}]).length,0)
  assert.equal(safeChatImages([{...a.images[0],mimeType:'image/jpeg'}]).length,0)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('守卫拒绝/缺失原图明确失败，不读取任意路径、不伪造成功',()=>{
 const store=createChatImageStore(()=>({ok:false,error:'拒绝'}))
 const r=store.persist([{mimeType:'image/png',url:'data:image/png;base64,'+png}])
 assert.equal(r.failures,1);assert.equal(r.images.length,1)
 assert.equal(JSON.stringify(r).includes(png),false)
 assert.throws(()=>store.read(r.images[0]))
 assert.throws(()=>store.read({url:'file:///etc/passwd',mimeType:'image/png'}))
})
test('被替换文件或软链接不得当成可信图片；恢复只接受同一图片字节',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-image-test-'))
 try{
  const store=createChatImageStore(name=>({ok:true,path:path.join(dir,name)}))
  const im=store.persist([{mimeType:'image/png',url:'data:image/png;base64,'+png}]).images[0]
  const file=path.join(dir,im.url.split(':')[1])
  fs.unlinkSync(file)
  const outside=path.join(dir,'outside');fs.writeFileSync(outside,Buffer.from(png,'base64'));fs.symlinkSync(outside,file)
  assert.throws(()=>store.read(im),/符号链接/)
  assert.throws(()=>store.restore(im,Buffer.from(png,'base64')),/符号链接/)
  fs.unlinkSync(file)
  fs.writeFileSync(file,'altered')
  assert.throws(()=>store.read(im))
  assert.throws(()=>store.restore(im,Buffer.from('wrong')))
  store.restore(im,Buffer.from(png,'base64'));assert.equal(store.read(im).toString('base64'),png)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

import {persistHistoryImages} from './historyImages.ts'
test('全量旧历史离线迁移保留序号、用户附件及错误原文，保存失败保留原始字节',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-history-images-'))
 try{
  const store=createChatImageStore(name=>({ok:true,path:path.join(dir,name)}))
  const im={mimeType:'image/png',url:'data:image/png;base64,'+png}
  const turns=[{seq:1,role:'user',images:[{path:'/owned/user.png',url:''}]},{seq:2,role:'assistant',text:'原文',returnedImages:[im],execs:[{execId:'1',images:[im]}]}]
  const migrated=persistHistoryImages(turns,store,true) as typeof turns
  assert.equal(JSON.stringify(migrated).includes(png),false)
  assert.equal(migrated[0].images?.[0].path,'/owned/user.png')
  assert.equal(migrated[1].seq,2)
  assert.equal(fs.readdirSync(dir).length,1)
  const denied=createChatImageStore(()=>({ok:false}))
  assert.ok(JSON.stringify(persistHistoryImages(turns,denied,true)).includes(png),'失败不能覆盖掉旧档唯一原图')
  assert.equal(JSON.stringify(persistHistoryImages(turns,denied,false)).includes(png),false,'发给renderer仍不带原图')
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
import {saveArchive} from './agentHistoryArchive.ts'
test('迁移写失败后的renderer引用回存，不覆盖旧档唯一原图',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-history-failure-')),file=path.join(dir,'chat.json')
 try{
  const denied=createChatImageStore(()=>({ok:false}))
  const original=[{seq:1,role:'assistant',text:'old',execs:[],returnedImages:[{mimeType:'image/png',url:'data:image/png;base64,'+png}]}]
  fs.writeFileSync(file,JSON.stringify({turns:original}))
  const incoming=persistHistoryImages(original,denied,false) as typeof original
  incoming[0].text='new text'
  saveArchive(file,{cwd:null,resumeId:null,resumeCli:null,moduleId:null},incoming,(all,previous)=>persistHistoryImages(all,denied,true,previous) as typeof all)
  const saved=JSON.parse(fs.readFileSync(file,'utf8'))
  assert.ok(JSON.stringify(saved).includes(png),'唯一原图必须在磁盘旧档中保留直到成功入库')
  assert.equal(saved.turns[0].text,'new text')
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
