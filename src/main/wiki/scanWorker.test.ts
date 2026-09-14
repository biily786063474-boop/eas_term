import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Worker} from 'node:worker_threads'

test('知识库扫描 Worker 在临时库上回传笔记并退出',async()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'wiki-worker-'))
 fs.writeFileSync(path.join(d,'a.md'),'---\nsummary: 甲\ntags: [x]\n---\n正文 [[b]]\n')
 fs.writeFileSync(path.join(d,'b.md'),'没有 front-matter 的一页\n')
 const w=new Worker(new URL('./scanWorker.ts',import.meta.url),{workerData:{root:d}})
 try{
  const msg=await new Promise<{ok:boolean;notes?:{rel:string;links:string[]}[];error?:string}>((res,rej)=>{w.once('message',res);w.once('error',rej);setTimeout(()=>rej(Error('20s 没回消息')),20000).unref()})
  assert.equal(msg.ok,true,msg.error)
  assert.deepEqual(msg.notes!.map(n=>n.rel).sort(),['a.md','b.md'])
  assert.deepEqual(msg.notes!.find(n=>n.rel==='a.md')!.links,['b'])
  assert.equal(await new Promise<number>(r=>w.once('exit',r)),0)
 }finally{await w.terminate();fs.rmSync(d,{recursive:true,force:true})}
})
