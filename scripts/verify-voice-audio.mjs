// Real local recordings shipped with the existing ASR model; no microphone, network, or model API.
import fs from 'node:fs'
import path from 'node:path'
import {Worker} from 'node:worker_threads'
import {createRequire} from 'node:module'
import {voiceAsrWorkerCode} from '../src/main/voiceAsrWorker.ts'
import {voiceVadWorkerCode} from '../src/main/voiceVadWorker.ts'
import {VoiceGate} from '../src/main/voiceGate.ts'
const require=createRequire(import.meta.url),root=process.cwd(),models=path.join(root,'resources/models'),out=path.join(root,'docs/verification/voice')
fs.mkdirSync(out,{recursive:true})
function rpc(code,extra){const w=new Worker(code,{eval:true,execArgv:[],workerData:{sherpaPath:require.resolve('sherpa-onnx'),...extra}});let n=0;const callbacks=new Map();let done;const ready=new Promise((resolve,reject)=>{done=resolve;w.on('error',reject)});w.on('message',m=>{if(m.ready||m.type==='ready')done();else if(m.error||m.type==='fatal'){console.error(m.error||m.err)}if(m.id){callbacks.get(m.id)?.(m);callbacks.delete(m.id)}});return {ready,async call(samples){await ready;return new Promise(resolve=>{const id=++n;callbacks.set(id,resolve);w.postMessage({id,samples,targetId:'audio-fixture'})})},stop:()=>w.terminate()}}
function wav(file){const b=fs.readFileSync(file);let rate,channels,bits,data;for(let off=12;off+8<=b.length;){const name=b.toString('ascii',off,off+4),len=b.readUInt32LE(off+4);if(name==='fmt '){channels=b.readUInt16LE(off+10);rate=b.readUInt32LE(off+12);bits=b.readUInt16LE(off+22)}if(name==='data')data=b.subarray(off+8,off+8+len);off+=8+len+(len%2)}if(rate!==16000||channels!==1||bits!==16||!data)throw Error('Expected mono 16k PCM16 '+file);return Float32Array.from({length:Math.min(data.length/2,16000*12)},(_,i)=>data.readInt16LE(i*2)/32768)}
const asr=rpc(voiceAsrWorkerCode,{dir:path.join(models,'sherpa-onnx-sense-voice')})
const timeout=setTimeout(()=>{console.error('Audio regression timeout');asr.stop();process.exit(1)},240000)
const cases=[];let seed=1
const noise=new Float32Array(16000*4);for(let i=0;i<noise.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise[i]=(seed/4294967296-.5)*.06}
cases.push(['silence',new Float32Array(16000*4)],['white-noise',noise])
const transition=new Float32Array(16000*6);transition.set(noise,16000*2);cases.push(['silence-to-noise',transition])
cases.push(['fan',Float32Array.from(noise,(v,i)=>v*.3+Math.sin(2*Math.PI*120*i/16000)*.025)])
cases.push(['keyboard',Float32Array.from(noise,(_,i)=>(i%6400<160 ? Math.sin(i*1.7)*.35*Math.exp(-(i%6400)/30) : 0))])
cases.push(['tones',Float32Array.from(noise,(_,i)=>(Math.sin(2*Math.PI*220*i/16000)+Math.sin(2*Math.PI*440*i/16000))*.025)])
const dir=path.join(models,'sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13/test_wavs')
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.wav')).slice(0,3)){const f=wav(path.join(dir,file));cases.push([file,f]);cases.push([file+'+noise',Float32Array.from(f,(v,i)=>Math.max(-1,Math.min(1,v+noise[i%noise.length]*.3)))])}
const results=[]
try{await asr.ready;for(const [name,samples] of cases){const start=Date.now();const baseline=await asr.call(samples);const vad=rpc(voiceVadWorkerCode,{model:path.join(models,'sherpa-onnx-silero-vad/silero_vad.onnx')});const gate=new VoiceGate(),kept=[];let speechFrames=0;try{await vad.ready;const padded=new Float32Array(Math.ceil((samples.length+16000)/2048)*2048);padded.set(samples);for(let i=0;i<padded.length;i+=2048){const f=padded.slice(i,i+2048),m=await vad.call(f);if(m.speech)speechFrames++;kept.push(...gate.push(f,m.speech))}}finally{await vad.stop()}const admitted=speechFrames*128>=400;const gated=new Float32Array(kept.reduce((s,f)=>s+f.length,0));let offset=0;for(const f of kept){gated.set(f,offset);offset+=f.length}const enhanced=admitted?await asr.call(gated):{text:''};const result={name,seconds:samples.length/16000,baseline:baseline.text,enhanced:enhanced.text,speechFrames,keptSeconds:gated.length/16000,elapsedMs:Date.now()-start};results.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(out,'audio-result.json'),JSON.stringify({scope:'Real fixture audio; baseline versus VAD-filtered SenseVoice, not ground-truth CER or live microphone validation',results},null,2))}}finally{clearTimeout(timeout);await asr.stop()}
if(results.some(r=>!r.name.includes('.wav')&&r.enhanced)||results.some(r=>r.name.endsWith('.wav')&&(!r.baseline||r.baseline!==r.enhanced))){process.exitCode=1}
