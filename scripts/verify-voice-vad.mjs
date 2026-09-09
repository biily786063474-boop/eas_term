import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { voiceVadWorkerCode } from '../src/main/voiceVadWorker.ts'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const worker = new Worker(voiceVadWorkerCode, {eval:true,execArgv:[],workerData:{strong:process.argv.includes('--strong'),model:process.cwd()+'/resources/models/sherpa-onnx-silero-vad/silero_vad.onnx',sherpaPath:require.resolve('sherpa-onnx')}})
let counter=0, detections=0, silenceDetections=0, seed=1
const timeout=setTimeout(()=>{console.error('VAD timeout');worker.terminate();process.exitCode=1},20000)
worker.on('error', error=>{console.error(error);clearTimeout(timeout);process.exitCode=1})
worker.on('message',m=>{
 if(m.error){console.error(m.error);clearTimeout(timeout);worker.terminate();process.exitCode=1;return}
 if(m.id){detections+=Number(m.speech);if(counter<50)silenceDetections+=Number(m.speech); counter++}
 if(counter===100){assert.equal(silenceDetections,0,'digital silence must not trigger speech');console.log(JSON.stringify({silenceFrames:50,silenceDetections,noiseFrames:50,noiseDetections:detections-silenceDetections,scope:'Diagnostic only: noise detections are not ASR false words. Human audio and old/new ASR comparison still required.'}));clearTimeout(timeout);worker.terminate();return}
 const f=new Float32Array(2048)
 if(counter>=50)for(let i=0;i<f.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;f[i]=(seed/4294967296-.5)*.06}
 worker.postMessage({id:counter+1,samples:f},[f.buffer])
})
