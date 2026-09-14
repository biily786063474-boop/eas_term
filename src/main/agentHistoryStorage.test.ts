import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeHistorySnapshot } from './agentHistoryStorage.ts'

test('原子写入有效记录；空快照保留上一份', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-history-test-'))
 try {
 const file=path.join(dir,'chat-1.json')
 assert.equal(writeHistorySnapshot(file,{turns:[{text:'保留'}]}),true)
 assert.equal(writeHistorySnapshot(file,{turns:[]}),false)
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).turns[0].text,'保留')
 assert.deepEqual(fs.readdirSync(dir),['chat-1.json'])
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
test('序列化失败不损坏旧记录',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-history-test-'))
 try {
 const file=path.join(dir,'chat-1.json');fs.writeFileSync(file,'old')
 const value:any={turns:[{}]};value.self=value
 assert.throws(()=>writeHistorySnapshot(file,value))
 assert.equal(fs.readFileSync(file,'utf8'),'old')
 assert.deepEqual(fs.readdirSync(dir),['chat-1.json'])
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('保存 205 份不会淘汰早期记录',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-history-test-'))
 try{for(let i=0;i<205;i++)writeHistorySnapshot(path.join(dir,`chat-${i}.json`),{turns:[{text:String(i)}]});assert.equal(fs.readdirSync(dir).length,205);assert.ok(fs.existsSync(path.join(dir,'chat-0.json')))}finally{fs.rmSync(dir,{recursive:true,force:true})}
})
