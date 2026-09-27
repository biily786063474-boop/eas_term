#!/usr/bin/env node
// Bounded, no-account soak. Reuses verify-app isolation and real runtimeMonitor metrics.
// Never sends a model prompt, allocates pressure, forces GC, or patches product source.
import {assertPortFree,assertPortOwned,ownedPids,remainingPids} from './lib/diagnostic-safety.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {spawn,execFileSync} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1]}
const cycles=Number(arg('--cycles',10)),active=Number(arg('--active',30)),cooldown=Number(arg('--cooldown',30)),idle=Number(arg('--idle',300)),port=Number(arg('--port',9463))
assert.ok(Number.isInteger(cycles)&&cycles>=1&&cycles<=20)
assert.ok([active,cooldown,idle].every(n=>Number.isInteger(n)&&n>=6&&n<=600))
assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535)
assertPortFree(port)
const root=process.cwd(),out=path.join(root,'docs/verification/memory-soak'),fixtures=path.join(root,'scratchpad/memory-soak-fixtures')
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(fixtures,{recursive:true})
assert.ok(!fs.existsSync(path.join(out,'RUNNING.local')),'existing run must be checked, not overwritten')
fs.writeFileSync(path.join(out,'RUNNING.local'),String(process.pid),{flag:'wx'})
const abort=new AbortController(),sleep=ms=>delay(ms,undefined,{signal:abort.signal}),sockets=[]
process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort())
const started=Date.now(),samples=[],checks=[],cycleResults=[]
let child,main,windowId,passed=false,error=null
const result={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),platform:os.platform(),physicalMemoryBytes:os.totalmem(),configuration:{cycles,active,cooldown,idle},scope:'real rendering/IPC and OS RSS; idle AI panes only; no LLM call; not physical 16GB pressure or overnight soak',samples,checks,cycleResults}
function persist(){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,elapsedSeconds:Math.round((Date.now()-started)/1000),passed,error},null,2))}
function progress(s){console.log(new Date().toISOString()+' '+s);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({at:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-started)/1000),phase:s,samples:samples.length,cyclesDone:cycleResults.length},null,2));persist()}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {ws,send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
const targets=()=>{assertPortOwned(port,child?.pid);return fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())}
async function until(fn,label){for(let i=0;i<80;i++){abort.signal.throwIfAborted();const r=await fn();if(r)return r;await sleep(500)}throw Error('Timed out: '+label)}
async function shot(name){const r=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
async function sample(phase){const m=await main.eval('(async()=>{if(!window.__easVerify)throw Error("Not isolated");const m=await window.api.runtimeMonitor(true);return {sampledAt:m.sampledAt,totalMemoryBytes:m.totalMemoryBytes,memoryUsedBytes:m.memoryUsedBytes,processes:m.processes,processTree:m.processTree}})()');assert.ok(m.processTree?.residentBytes>0,'live RSS available');const heap=await main.send('Runtime.getHeapUsage');const dom=await main.eval('({images:document.querySelectorAll(".cfile-body img").length,webviews:document.querySelectorAll("webview").length,plugins:document.querySelectorAll(".plg-frame").length,agentPanes:document.querySelectorAll(".agent-chat-view").length})');samples.push({phase,elapsedSeconds:Math.round((Date.now()-started)/1000),...m,rendererHeapUsedBytes:heap.usedSize,dom,targetCount:(await targets()).length});persist();return samples.at(-1)}
async function observe(phase,seconds){await sample(phase);for(let i=0;i<Math.ceil(seconds/6);i++){await sleep(6000);await sample(phase)}progress(phase+' observed '+seconds+'s')}
function check(v,label){assert.ok(v,label);checks.push(label)}
const picture=path.join(fixtures,'sample.png'),model=path.join(fixtures,'sphere.glb'),html=path.join(fixtures,'local.html')
const source=fs.readFileSync(path.join(root,'scripts/verify-low-memory-workloads.mjs'),'utf8')
// Reuse the previously verified procedural GLB fixture verbatim, not an external download.
const sphere=source.slice(source.indexOf('const positions=[]'),source.indexOf('const model=path.join'))
new Function('fs','model',sphere+'\nfs.writeFileSync(model,Buffer.concat([header,json,binHeader,bin]));')(fs,model)
fs.copyFileSync(path.join(root,'docs/verification/low-memory/recovery-dark.png'),picture)
fs.writeFileSync(html,'<!doctype html><html><head><meta charset="utf-8"><title>Local soak fixture</title></head><body style="background:#151821;color:#ddd"><h1>离线页面回收测试</h1><p>无外部依赖，无网络请求。</p></body></html>')
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||['ELECTRON_RUN_AS_NODE','EAS_PTY_ID','EAS_PROJECT'].includes(k))delete env[k]
try{
 const log=fs.openSync(path.join(out,'app.local.log'),'w');child=spawn(process.execPath,['scripts/verify-app.mjs','--port',String(port)],{cwd:root,env,stdio:['ignore',log,log]});fs.closeSync(log)
 const page=await until(async()=>{if(child.exitCode!==null)throw Error('Isolated launcher exited');try{return(await targets()).find(t=>t.type==='page'&&t.title==='Eas-Term')}catch{return null}},'main target')
 main=await connect(page.webSocketDebuggerUrl)
 await until(()=>main.eval('Boolean(window.__easVerify&&window.__store&&window.api?.runtimeMonitor)'),'verify hook')
 result.appProcessBaseline=await main.eval('window.api.runtimeMonitor(true).then(m=>m.processTree?.processCount)')
 const dep=await main.eval('window.api.modelDep.status()');if(!dep.installed){const d=await main.eval('window.api.modelDep.download()');check(d.ok,'pinned 3D dependency ready')}
 check(await main.eval('window.api.plugins.list().then(p=>p.some(x=>x.id==="eas:execution-plan"))'),'builtin execution-plan discovered')
 await main.eval('window.__store.setState({viewMode:"canvas",tabs:[],activeTabId:null})')
 progress('baseline');await observe('baseline',60)
 const frames=Array.from({length:3},(_,i)=>({id:'soak-frame-'+i,projectId:'p-verify',name:'空闲 AI '+i,x:20+i*430,y:20,w:420,h:560,collapsed:false,nodes:[{id:'soak-agent-'+i,leafId:'soak-leaf-'+i,x:10,y:40,w:400,h:500}]}))
 const tabs=frames.map((f,i)=>({id:'soak-tab-'+i,title:f.name,cwd:root,projectId:'p-verify',activeLeafId:'soak-leaf-'+i,root:{type:'leaf',id:'soak-leaf-'+i,pane:{kind:'agent',cli:'claude',cwd:root}}}))
 await main.eval('(()=>{const s=window.__store.getState();window.__store.setState({tabs:'+JSON.stringify(tabs)+',activeTabId:"soak-tab-0",canvas:{...s.canvas,viewport:{x:0,y:0,scale:0.75},frames:'+JSON.stringify(frames)+',freeNodes:[]}});return true})()')
 await until(()=>main.eval('document.querySelectorAll(".agent-chat-view").length===3'),'3 idle panes')
 for(let i=0;i<3;i++){await main.eval('window.__store.getState().setMaximizedNode({frameId:"soak-frame-'+i+'",nodeId:"soak-agent-'+i+'"})');await observe('frame-max-'+i,18);await main.eval('window.__store.getState().setMaximizedNode(null)')}
 await shot('three-idle-frames')
 try{const w=await main.send('Browser.getWindowForTarget',{targetId:page.id});windowId=w.windowId;await main.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});await observe('window-minimized',30);await main.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});checks.push('native window minimize/restore via CDP')}catch(e){result.windowMinimize={verified:false,reason:String(e).slice(0,180)}}
 await observe('frames-restored',30)
 await main.eval('(()=>{const s=window.__store.getState();for(const f of s.canvas.frames)for(const n of f.nodes)s.removeNode(f.id,n.id);window.__store.setState({tabs:[],activeTabId:null,canvas:{...window.__store.getState().canvas,frames:[]}});return true})()')
 for(let i=1;i<=cycles;i++){
  progress('cycle '+i+'/'+cycles+' opening')
  const frame={id:'soak-media',projectId:'p-verify',name:'循环 '+i+' · 真实媒体/插件',x:10,y:10,w:1540,h:920,collapsed:false,nodes:[{id:'soak-image',x:10,y:30,w:740,h:410,pane:{kind:'image',filePath:picture}},{id:'soak-model',x:780,y:30,w:740,h:410,pane:{kind:'image',filePath:model}},{id:'soak-html',x:10,y:480,w:740,h:410,pane:{kind:'web',url:pathToFileURL(html).href}},{id:'soak-plugin',x:780,y:480,w:740,h:410,component:{type:'plugin-panel',props:{pluginId:'eas:execution-plan',panelId:'main'}}}]}
  await main.eval('(()=>{const s=window.__store.getState();window.__store.setState({maximizedNode:null,canvas:{...s.canvas,viewport:{x:0,y:0,scale:0.65},frames:['+JSON.stringify(frame)+']}});return true})()')
  await until(()=>main.eval('[...document.querySelectorAll(".cfile-body img")].some(x=>x.complete&&x.naturalWidth>0)'),'decoded image')
  const modelPage=await until(async()=>(await targets()).find(t=>t.url.startsWith('easmodel://')),'3D guest')
  const mc=await connect(modelPage.webSocketDebuggerUrl)
  await until(()=>mc.eval('Boolean(document.querySelector("model-viewer")?.loaded)'),'WebGL loaded');mc.ws.close()
  await until(()=>main.eval('Boolean(document.querySelector(".plg-frame"))'),'real plugin iframe')
  const htmlPage=await until(async()=>(await targets()).find(t=>t.url===pathToFileURL(html).href),'local HTML guest')
  const hc=await connect(htmlPage.webSocketDebuggerUrl);await until(()=>hc.eval('document.body.innerText.includes("离线页面回收测试")'),'local HTML rendered');hc.ws.close()
  if(i===1||i===cycles)await shot('media-cycle-'+i)
  await observe('cycle-'+i+'-open',active)
  await main.eval('(()=>{const s=window.__store.getState();for(const f of s.canvas.frames)for(const n of f.nodes)s.removeNode(f.id,n.id);return true})()')
  await until(()=>main.eval('document.querySelectorAll("webview,.plg-frame,.cfile-body img").length===0'),'all guest nodes unmounted')
  await observe('cycle-'+i+'-closed',cooldown)
  const s=samples.at(-1);cycleResults.push({cycle:i,residentBytes:s.processTree.residentBytes,processCount:s.processTree.processCount,heapUsedBytes:s.rendererHeapUsedBytes,targetCount:s.targetCount});persist()
 }
 progress('final cooldown');await observe('final-idle',idle);await shot('final-idle')
 check(cycleResults.length===cycles,'all open/close cycles completed')
 check(samples.at(-1).dom.webviews===0&&samples.at(-1).dom.plugins===0,'no guest DOM after cooldown')
 // Trend is evidence, not a universal leak threshold. Do not force GC or claim 16GB adaptation.
 const tail=samples.filter(x=>x.phase==='final-idle'),peak=Math.max(...samples.map(s=>s.processTree.residentBytes))
 result.summary={sampleCount:samples.length,peakResidentBytes:peak,initialResidentBytes:samples[0].processTree.residentBytes,finalResidentBytes:tail.at(-1).processTree.residentBytes,firstClosedResidentBytes:cycleResults[0].residentBytes,lastClosedResidentBytes:cycleResults.at(-1).residentBytes,finalProcessCount:tail.at(-1).processTree.processCount,finalTargetCount:tail.at(-1).targetCount,finalHeapUsedBytes:tail.at(-1).rendererHeapUsedBytes}
 passed=true;progress('PASS functional soak; memory trend requires review')
}catch(e){error=String(e);progress('FAILED '+error);process.exitCode=1}
finally{
 try{if(main&&windowId!==undefined)await main.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}})}catch{}
 for(const ws of sockets)ws.close();const owned=ownedPids(child?.pid)
 if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGINT');await Promise.race([ended,delay(10000)])}
 const remaining=await remainingPids(owned)
 result.cleanup={remainingOwnedCount:remaining.length,launcherExited:Boolean(child&&(child.exitCode!==null||child.signalCode!==null))};if(!result.cleanup.launcherExited||remaining.length){passed=false;error='diagnostic launcher did not exit';process.exitCode=1};for(const f of [picture,model,html])fs.rmSync(f,{force:true});fs.rmSync(path.join(out,'RUNNING.local'),{force:true});persist()
 console.log('Own isolated instance cleanup: '+JSON.stringify(result.cleanup))
}
