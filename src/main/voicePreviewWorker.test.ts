import {test} from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import {voicePreviewWorkerCode} from './voicePreviewWorker.ts'
test('streaming worker processes audio/take FIFO and resets text at sentence boundaries',async()=>{
 const port=new EventEmitter() as EventEmitter&{postMessage:(m:any)=>void},messages:any[]=[]
 port.postMessage=m=>messages.push(m)
 const rec={createStream:()=>({text:'',acceptWaveform(_sr:number,a:Float32Array){this.text+=String(a[0])},inputFinished(){},free(){}}),isReady:()=>false,getResult:(s:any)=>({text:s.text}),isEndpoint:(s:any)=>s.text==='3',reset:(s:any)=>{s.text=''}}
 const require=(id:string)=>id==='node:worker_threads'?{parentPort:port,workerData:{dir:'/model',sherpaPath:'/runtime/index.js'}}:id==='node:path'?{dirname:()=>'/runtime',join:(...p:string[])=>p.join('/')}:id==='node:fs'?{readdirSync:()=>['encoder.int8.onnx','decoder.onnx','joiner.int8.onnx']}:id.endsWith('sherpa-onnx-wasm-nodejs.js')?async()=>({}):{createOnlineRecognizer:()=>rec}
 vm.runInNewContext(voicePreviewWorkerCode,{require,Float32Array,console})
 await new Promise(r=>setImmediate(r));assert.equal(messages[0]?.type,'ready')
 port.emit('message',{type:'audio',id:1,samples:new Float32Array([1]),targetId:'a'})
 port.emit('message',{type:'take',id:2})
 port.emit('message',{type:'audio',id:3,samples:new Float32Array([2]),targetId:'b'})
 port.emit('message',{type:'take',id:4})
 await new Promise(r=>setImmediate(r))
 assert.deepEqual(messages.filter(m=>m.type==='result').map(m=>[m.id,m.text]),[[2,'1'],[4,'2']])
 port.emit('message',{type:'audio',id:5,samples:new Float32Array([3]),targetId:'c'})
 await new Promise(r=>setImmediate(r))
 assert.equal(messages.find(m=>m.type==='partial'&&m.id===5).text,'3','endpoint reset must not duplicate committed text')
 assert.deepEqual(messages.filter(m=>m.type==='partial'&&m.id<5).map(m=>[m.targetId,m.text]),[['a','1'],['b','2']])
})
