#!/usr/bin/env node
// Real rendering/OS metrics, never a fake transport. Requires an already-running EAS_VERIFY app.
// No credentials copied and no model message sent. Claude login readiness is recorded separately.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
const portIndex=process.argv.indexOf('--port')
const port=Number(portIndex<0?9446:process.argv[portIndex+1])
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port')
const out=path.resolve('docs/verification/low-memory'),fixtures=path.resolve('scratchpad/low-memory-fixtures')
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(fixtures,{recursive:true})
const evaluate=expression=>JSON.parse(execFileSync(process.execPath,['scripts/eval-in-app.mjs',expression,'--port',String(port)],{encoding:'utf8',timeout:20000}))
assert.equal(evaluate('Boolean(window.__easVerify)'),true,'isolated instance required')
const sample=(phase,seconds)=>execFileSync(process.execPath,['scripts/verify-low-memory.mjs','--port',String(port),'--phase',phase,'--seconds',String(seconds)],{stdio:'inherit',timeout:(seconds+45)*1000})
async function cdp(target,method,params){
 const ws=new WebSocket(target.webSocketDebuggerUrl)
 try{
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  return await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('CDP timeout')),15000)
   ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id!==1)return;clearTimeout(timeout);m.error?reject(Error(m.error.message)):resolve(m.result)}
   ws.send(JSON.stringify({id:1,method,params}))
  })
 }finally{ws.close()}
}
const targets=()=>fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())
async function screenshot(name){const target=(await targets()).find(t=>t.type==='page'&&t.title==='Eas-Term');const shot=await cdp(target,'Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'))}
const auth=evaluate("window.api.cliAuth.check('claude').then(s=>({installed:s.installed,loggedIn:s.status?.loggedIn??null}))")
fs.writeFileSync(path.join(out,'first-message-readiness.json'),JSON.stringify({cli:'claude',...auth,measured:false,reason:auth.loggedIn?'Logged in; this renderer baseline does not send model requests':'Claude login unavailable; successful first-token/start latency not measured'},null,2))

// Procedural, local-only sphere fixture: 20,000 triangles, no external textures or network assets.
const positions=[];const n=100
const vertex=(u,v)=>{const a=u*2*Math.PI,b=v*Math.PI;positions.push(Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a))}
for(let y=0;y<n;y++)for(let x=0;x<n;x++){
 vertex(x/n,y/n);vertex((x+1)/n,y/n);vertex(x/n,(y+1)/n)
 vertex((x+1)/n,y/n);vertex((x+1)/n,(y+1)/n);vertex(x/n,(y+1)/n)
}
const bin=Buffer.from(new Float32Array(positions).buffer)
const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[0.15,0.6,0.85,1],metallicFactor:0,roughnessFactor:0.5}}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bin.length}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]}]}
const raw=Buffer.from(JSON.stringify(gltf)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json)
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16)
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4)
const model=path.join(fixtures,'baseline-sphere.glb'),picture=path.join(fixtures,'baseline-image.png')
fs.writeFileSync(model,Buffer.concat([header,json,binHeader,bin]));fs.copyFileSync(path.join(out,'recovery-dark.png'),picture)
const frames=Array.from({length:3},(_,i)=>({id:'baseline-frame-'+i,projectId:'p-verify',name:'基线 Frame '+(i+1),x:20+i*420,y:20,w:400,h:560,collapsed:false,nodes:[]}))
const tabs=frames.map((f,i)=>({id:'baseline-tab-'+i,title:f.name,cwd:process.cwd(),projectId:'p-verify',activeLeafId:'baseline-leaf-'+i,root:{type:'leaf',id:'baseline-leaf-'+i,pane:{kind:'agent',cli:'claude',cwd:process.cwd()}}}))
frames.forEach((f,i)=>f.nodes.push({id:'baseline-node-'+i,leafId:'baseline-leaf-'+i,x:10,y:40,w:380,h:500}))
evaluate(`(()=>{const s=window.__store.getState();window.__store.setState({tabs:${JSON.stringify(tabs)},activeTabId:'baseline-tab-0',viewMode:'canvas',maximizedNode:null,canvas:{...s.canvas,viewport:{x:0,y:0,scale:0.8},frames:${JSON.stringify(frames)},freeNodes:[]}});return true})()`)
await sleep(3000)
assert.equal(evaluate("document.querySelectorAll('.agent-chat-view').length"),3)
await screenshot('three-frames');sample('three-frames',30)
console.log('Three real idle conversation Frames measured; no CLI task started')

// Download via the existing pinned, hash-verified application dependency path.
const dep=evaluate('window.api.modelDep.status()')
if(!dep.installed){const result=evaluate('window.api.modelDep.download()');assert.equal(result.ok,true,'3D viewer download must succeed, never simulate loaded')}
const mediaFrame={id:'baseline-media',projectId:'p-verify',name:'真实媒体 / 3D 基线',x:10,y:10,w:1250,h:620,collapsed:false,nodes:[
 {id:'baseline-image',x:15,y:40,w:570,h:550,pane:{kind:'image',filePath:picture}},
 {id:'baseline-model',x:605,y:40,w:620,h:550,pane:{kind:'image',filePath:model}}
]}
evaluate(`(()=>{const s=window.__store.getState();window.__store.setState({tabs:[],activeTabId:null,canvas:{...s.canvas,viewport:{x:0,y:0,scale:0.8},frames:[${JSON.stringify(mediaFrame)}]}});return true})()`)
let loaded=false
for(let i=0;i<40;i++){
 await sleep(500)
 const modelTarget=(await targets()).find(t=>t.url.startsWith('easmodel://'))
 if(!modelTarget)continue
 const r=await cdp(modelTarget,'Runtime.evaluate',{expression:"Boolean(document.querySelector('model-viewer')?.loaded)",returnByValue:true})
 if(r.result.value){loaded=true;break}
}
assert.equal(loaded,true,'actual WebGL model viewer must report loaded')
assert.equal(evaluate("[...document.querySelectorAll('.cfile-body img')].some(i=>i.complete&&i.naturalWidth>0)"),true,'actual image decoded')
await screenshot('media');sample('media',30)
evaluate("(()=>{const s=window.__store.getState();for(const f of s.canvas.frames)for(const n of f.nodes)s.removeNode(f.id,n.id);return true})()")
await sleep(2000)
assert.equal(evaluate("document.querySelectorAll('webview.model-frame').length"),0)
sample('media-closed',180);await screenshot('media-closed')
fs.writeFileSync(path.join(out,'workload-result.json'),JSON.stringify({passed:true,physicalMemoryBytes:os.totalmem(),scope:'real rendering and OS process snapshots; no live LLM inference',threeFrames:{count:3,kind:'idle conversation panels',seconds:30},media:{image:true,modelLoaded:true,triangles:20000,seconds:30},closed:{webviews:0,seconds:180},firstClaude:auth.loggedIn?'not sent':'blocked: not logged in'},null,2))
for(const file of [model,picture])fs.rmSync(file,{force:true})
console.log('Real workload baseline PASS (Claude successful first message not measured)')
