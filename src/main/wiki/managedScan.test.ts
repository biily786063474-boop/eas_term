import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {scanNotesManaged} from './managedScan.ts'

// 知识库全库扫描原来在主进程同步逐篇 readFileSync（图谱/体检两个 IPC 都是同步处理器），
// 库大时按篇数比例卡主线程。现在与符号索引同一套：Worker 里扫，按窗口归属准入。
class FakeWorker extends EventEmitter { terminated=0; terminate(){this.terminated++;setImmediate(()=>this.emit('exit',1));return Promise.resolve(1)} }
type Run=NonNullable<Parameters<typeof scanNotesManaged>[0]['run']>

test('放行前不建线程；notes 回调用方；名字与窗口归属正确',async()=>{
 let created=0;const w=new FakeWorker();const calls:{name:string;windowId:number|null;projectId:string|null}[]=[]
 const run:Run=async opts=>{calls.push({name:opts.name,windowId:opts.windowId,projectId:opts.projectId});await new Promise(r=>setImmediate(r));assert.equal(created,0,'准入前不得建线程');const work=await opts.start(new AbortController().signal);return await work.result}
 const p=scanNotesManaged({root:'/wiki',windowId:9,createWorker:()=>{created++;return w},run})
 await new Promise(r=>setTimeout(r,5))
 w.emit('message',{ok:true,notes:[{rel:'a.md',title:'a',summary:'',tags:[],links:[],mtime:0,bodyChars:1}]})
 const notes=await p
 assert.equal(notes.length,1);assert.equal(calls[0].windowId,9);assert.equal(calls[0].projectId,null);assert.match(calls[0].name,/知识库/)
})

test('排队超时与取消都说人话',async()=>{
 await assert.rejects(scanNotesManaged({root:'/wiki',windowId:9,createWorker:()=>new FakeWorker(),run:async()=>{throw Error('wait timeout')}}),/资源紧张/)
 await assert.rejects(scanNotesManaged({root:'/wiki',windowId:9,createWorker:()=>new FakeWorker(),run:async()=>{throw Error('cancelled')}}),/已取消/)
})
