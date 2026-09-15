/** Dedicated preview decoder. Main owns admission and bounds in-flight messages. */
export const voicePreviewWorkerCode = `
const {parentPort,workerData}=require('node:worker_threads')
const path=require('node:path'),fs=require('node:fs')
let rec,stream,committed='',failed=false
const pick=kind=>{
 const files=fs.readdirSync(workerData.dir).filter(f=>f.startsWith(kind)&&f.endsWith('.onnx'))
 return path.join(workerData.dir,files.find(f=>f.includes('int8'))||files[0]||kind+'.onnx')
}
const ready=(async()=>{
 const runtime=path.dirname(workerData.sherpaPath)
 const wasm=await require(path.join(runtime,'sherpa-onnx-wasm-nodejs.js'))({})
 rec=require(path.join(runtime,'sherpa-onnx-asr.js')).createOnlineRecognizer(wasm,{
  featConfig:{sampleRate:16000,featureDim:80},
  modelConfig:{transducer:{encoder:pick('encoder'),decoder:pick('decoder'),joiner:pick('joiner')},tokens:path.join(workerData.dir,'tokens.txt'),numThreads:2,provider:'cpu',debug:0},
  decodingMethod:'greedy_search',enableEndpoint:1,rule1MinTrailingSilence:2.4,rule2MinTrailingSilence:1,rule3MinUtteranceLength:20
 })
 stream=rec.createStream()
 parentPort.postMessage({type:'ready'})
})()
const fatal=error=>{if(failed)return;failed=true;parentPort.postMessage({type:'fatal',error:String(error)})}
ready.catch(fatal)
let queue=Promise.resolve(),queued=0
parentPort.on('message',m=>{
 if(failed)return
 // reset：录音结束（或被取消）时换一个新 stream，不重建 worker —— 模型加载 2.8s，stream 1ms。
 // 走同一条 FIFO，排在已收到的音频之后，不会把上一句正在处理的帧切掉一半。
 if(m.type==='reset'){queued++;queue=queue.then(async()=>{try{await ready;if(failed)return;stream.free();stream=rec.createStream();committed=''}catch(error){fatal(error)}finally{queued--}});return}
 if(queued>=64||!Number.isSafeInteger(m.id)||!['audio','take'].includes(m.type)){fatal('invalid preview request or queue full');return}
 if(m.type==='audio'&&(!(m.samples instanceof Float32Array)||m.samples.length<1||m.samples.length>16384||typeof m.targetId!=='string'||m.targetId.length>100)){fatal('invalid preview audio');return}
 queued++
 queue=queue.then(async()=>{
  try{
   await ready
   if(failed)return
   if(m.type==='audio'){
    stream.acceptWaveform(16000,m.samples)
    while(rec.isReady(stream))rec.decode(stream)
    const text=String(rec.getResult(stream).text||'').trim()
    const endpoint=rec.isEndpoint(stream)
    if(endpoint){committed=(committed+text).trim();rec.reset(stream)}
    parentPort.postMessage({type:'partial',id:m.id,targetId:m.targetId,text:endpoint?committed:(committed+text).trim()})
    parentPort.postMessage({type:'ack',id:m.id})
   }else{
    stream.inputFinished()
    while(rec.isReady(stream))rec.decode(stream)
    const text=(committed+String(rec.getResult(stream).text||'').trim()).trim()
    stream.free();stream=rec.createStream();committed=''
    parentPort.postMessage({type:'result',id:m.id,text})
   }
  }catch(error){fatal(error)}finally{queued--}
 })
})
`
