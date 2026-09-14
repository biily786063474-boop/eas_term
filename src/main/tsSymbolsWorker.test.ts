import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Worker} from 'node:worker_threads'

// 真 Worker、真临时 TS 项目：提取结果通过 message 回来，线程随后自己退出。
test('符号索引 Worker 在临时项目上回传图并退出',async()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'sym-worker-'))
 fs.writeFileSync(path.join(d,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',strict:true},include:['**/*.ts']}))
 fs.writeFileSync(path.join(d,'a.ts'),"export function used(){return 1}\nexport function dead(){return 2}\n")
 fs.writeFileSync(path.join(d,'b.ts'),"import {used} from './a.ts'\nconsole.log(used())\n")
 const w=new Worker(new URL('./tsSymbolsWorker.ts',import.meta.url),{workerData:{root:d}})
 try{
  const msg=await new Promise<{ok:boolean;graph?:{files:{file:string}[]};error?:string}>((res,rej)=>{w.once('message',res);w.once('error',rej);setTimeout(()=>rej(Error('30s 没回消息')),30000).unref()})
  assert.equal(msg.ok,true,msg.error);assert.ok(msg.graph!.files.some(f=>f.file==='a.ts'))
  const code=await new Promise<number>(r=>w.once('exit',r))
  assert.equal(code,0,'跑完要自己退出')
 }finally{await w.terminate();fs.rmSync(d,{recursive:true,force:true})}
})
