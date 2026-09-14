import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {downloadFile} from './updateDownload.ts'

// 更新包下载原来内嵌在 updater.ts 里、不可取消。抽成零 electron 的模块：request 注入，
// 支持 AbortSignal（取消 = abort 请求 + 删掉 .part），成功才 rename 成正式文件名。
class FakeRes extends EventEmitter { statusCode=200; headers:Record<string,string>={'content-length':'6'} }
class FakeReq extends EventEmitter { aborted=0; res=new FakeRes(); abort(){this.aborted++} end(){setImmediate(()=>this.emit('response',this.res))} }

function tmpDest(){return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'upd-')),'Eas.dmg')}

test('成功：分块写入 .part，结束后改名并报进度',async()=>{
 const req=new FakeReq(),dest=tmpDest(),progress:number[]=[]
 const p=downloadFile({url:'https://x/Eas.dmg',dest,request:()=>req,onProgress:got=>progress.push(got)})
 await new Promise(r=>setTimeout(r,5))
 req.res.emit('data',Buffer.from('abc'));req.res.emit('data',Buffer.from('def'));req.res.emit('end')
 assert.equal(await p,dest);assert.equal(fs.readFileSync(dest,'utf8'),'abcdef');assert.deepEqual(progress,[3,6])
 assert.equal(fs.existsSync(dest+'.part'),false)
})

test('取消：中止请求、删 .part、拒绝',async()=>{
 const req=new FakeReq(),dest=tmpDest(),ac=new AbortController()
 const p=downloadFile({url:'https://x/Eas.dmg',dest,request:()=>req,onProgress(){},signal:ac.signal})
 await new Promise(r=>setTimeout(r,5))
 req.res.emit('data',Buffer.from('abc'))
 ac.abort()
 await assert.rejects(p,/已取消/)
 await new Promise(r=>setTimeout(r,5))
 assert.equal(req.aborted,1);assert.equal(fs.existsSync(dest+'.part'),false);assert.equal(fs.existsSync(dest),false)
})

test('非 200 直接拒绝，不落文件',async()=>{
 const req=new FakeReq();req.res.statusCode=404;const dest=tmpDest()
 const p=downloadFile({url:'https://x/Eas.dmg',dest,request:()=>req,onProgress(){}})
 await assert.rejects(p,/404/)
 assert.equal(fs.existsSync(dest+'.part'),false)
})
