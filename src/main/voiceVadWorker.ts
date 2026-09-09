// Runs off the Electron main thread. No network, no audio persistence.
export const voiceVadWorkerCode = `
const { parentPort, workerData } = require('node:worker_threads')
let vad, targetId
;(async () => {
try {
 const path = require('node:path')
 const dir = path.dirname(workerData.sherpaPath)
 const wasm = await require(path.join(dir, 'sherpa-onnx-wasm-nodejs.js'))({})
 const binding = require(path.join(dir, 'sherpa-onnx-vad.js'))
 vad = binding.createVad(wasm, {sileroVad:{model:workerData.model,threshold:workerData.strong ? 0.65 : 0.5,minSpeechDuration:0.15,minSilenceDuration:0.2,windowSize:512,maxSpeechDuration:20},sampleRate:16000,numThreads:1,provider:'cpu',bufferSizeInSeconds:30})
 if (!vad || !vad.handle) throw new Error('VAD initialization failed')
 parentPort.postMessage({ready:true})
} catch(e) { parentPort.postMessage({error:String(e)}) }
})()
parentPort.on('message', m => {
 if (!vad) return
 try {
  if (m.stop) { vad.free(); parentPort.close(); return }
  if (m.targetId !== targetId) { vad.reset(); targetId = m.targetId }
  const f = m.samples
  let speech = false
  for(let i=0;i<f.length;i+=512) {
   vad.acceptWaveform(f.subarray(i,i+512))
   speech = vad.isDetected() || speech
   while(!vad.isEmpty()) vad.pop()
  }
  parentPort.postMessage({id:m.id,speech,samples:f,targetId:m.targetId},[f.buffer])
 } catch(e) { parentPort.postMessage({error:String(e)}) }
})
`
