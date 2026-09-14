import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {analyzeSymbolsManaged} from './managedSymbols.ts'

// 符号索引原来是主进程同步 ts.createProgram，大项目整个界面冻几秒。现在：Worker 里跑，
// 起线程前按窗口归属排队；结果给调用方、完成只认线程 exit；取消 = terminate。
class FakeWorker extends EventEmitter { terminated=0; terminate(){this.terminated++;setImmediate(()=>this.emit('exit',1));return Promise.resolve(1)} }
type Run=NonNullable<Parameters<typeof analyzeSymbolsManaged>[0]['run']>
function passthrough():{run:Run;calls:{id:string;name:string;windowId:number|null;projectId:string|null;cost:{cpu:number;memoryBytes:number}}[];signal:AbortController}{
 const calls:ReturnType<typeof passthrough>['calls']=[],signal=new AbortController()
 // 模仿真 runManagedTask：中止时以 'cancelled' 拒绝调用方（线程的 exit 另走 completed）
 const run:Run=async opts=>{calls.push({id:opts.id,name:opts.name,windowId:opts.windowId,projectId:opts.projectId,cost:opts.cost});const w=await opts.start(signal.signal);return await Promise.race([w.result,new Promise<never>((_,rej)=>signal.signal.addEventListener('abort',()=>rej(Error('cancelled')),{once:true}))])}
 return {run,calls,signal}
}

test('放行前不建线程；结果先回、完成只认 exit',async()=>{
 let created=0;const worker=new FakeWorker()
 const gate=passthrough()
 let admitted=false
 const run:Run=async opts=>{await new Promise(r=>setImmediate(r));assert.equal(created,0,'准入前不得创建 Worker');admitted=true;return gate.run(opts)}
 const p=analyzeSymbolsManaged({root:'/proj',windowId:7,projectId:'p1',cost:{cpu:7,memoryBytes:1},createWorker:()=>{created++;return worker},run})
 await new Promise(r=>setTimeout(r,5))
 assert.equal(admitted,true);assert.equal(created,1)
 worker.emit('message',{ok:true,graph:{files:[],deadCode:[]}})
 assert.deepEqual(await p,{files:[],deadCode:[]})
 assert.equal(gate.calls[0].windowId,7);assert.equal(gate.calls[0].projectId,'p1');assert.match(gate.calls[0].name,/符号/)
})

test('取消即 terminate，调用方拒绝',async()=>{
 const worker=new FakeWorker();const gate=passthrough()
 const p=analyzeSymbolsManaged({root:'/proj',windowId:7,projectId:null,cost:{cpu:7,memoryBytes:1},createWorker:()=>worker,run:gate.run})
 await new Promise(r=>setTimeout(r,5))
 gate.signal.abort()
 await assert.rejects(p,/符号索引已取消/)
 assert.equal(worker.terminated,1)
})

test('线程报错或异常退出：调用方拒绝并带人话',async()=>{
 const worker=new FakeWorker();const gate=passthrough()
 const p=analyzeSymbolsManaged({root:'/proj',windowId:7,projectId:null,cost:{cpu:7,memoryBytes:1},createWorker:()=>worker,run:gate.run})
 await new Promise(r=>setTimeout(r,5))
 worker.emit('message',{ok:false,error:'这个项目里没有 tsconfig'})
 await assert.rejects(p,/没有 tsconfig/)
 const w2=new FakeWorker();const g2=passthrough()
 const p2=analyzeSymbolsManaged({root:'/proj',windowId:7,projectId:null,cost:{cpu:7,memoryBytes:1},createWorker:()=>w2,run:g2.run})
 await new Promise(r=>setTimeout(r,5))
 w2.emit('exit',137)
 await assert.rejects(p2,/符号索引线程/)
})

test('排队超时翻译成资源紧张文案',async()=>{
 const run:Run=async()=>{throw Error('wait timeout')}
 await assert.rejects(analyzeSymbolsManaged({root:'/proj',windowId:7,projectId:null,cost:{cpu:7,memoryBytes:1},createWorker:()=>new FakeWorker(),run}),/资源紧张/)
})
