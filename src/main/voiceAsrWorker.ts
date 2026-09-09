// Shared by production STT and the real-audio regression probe.
export const voiceAsrWorkerCode = `
const {parentPort,workerData}=require('node:worker_threads')
const path=require('node:path')
let rec
const ready=(async()=>{
 const dir=path.dirname(workerData.sherpaPath)
 const wasm=await require(path.join(dir,'sherpa-onnx-wasm-nodejs.js'))({})
 const {OfflineRecognizer}=require(path.join(dir,'sherpa-onnx-asr.js'))
 rec=new OfflineRecognizer({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{senseVoice:{model:path.join(workerData.dir,'model.int8.onnx'),language:'auto',useInverseTextNormalization:1},tokens:path.join(workerData.dir,'tokens.txt'),numThreads:2,provider:'cpu',debug:0},decodingMethod:'greedy_search'},wasm)
 if(!rec.handle)throw new Error('SenseVoice initialization failed')
 parentPort.postMessage({type:'ready'})
})()
ready.catch(e=>parentPort.postMessage({type:'fatal',err:String(e)}))
let queue=Promise.resolve(), queued=0
parentPort.on('message',m=>{
 if(queued>=8 || !(m.samples instanceof Float32Array) || m.samples.length>16000*31){parentPort.postMessage({type:'result',id:m.id,text:'',error:'ASR queue limit'});return}
 queued++
 queue=queue.then(async()=>{
  let stream
  try{await ready;stream=rec.createStream();stream.acceptWaveform(16000,m.samples);rec.decode(stream);parentPort.postMessage({type:'result',id:m.id,text:String(rec.getResult(stream).text||'').trim()})}
  catch(e){parentPort.postMessage({type:'result',id:m.id,text:'',error:String(e)})}
  finally{stream?.free();queued--}
 })
})
`
