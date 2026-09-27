#!/usr/bin/env node
// Single-variable, fresh-profile attribution. Product source and memory policy stay unchanged.
import {assertPortFree,assertPortOwned} from './lib/diagnostic-safety.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {spawn,execFileSync} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1]}
const kinds=arg('--kinds','control,image,html,model,plugin,ai,combined').split(',')
assert.ok(kinds.every(k=>['control','image','html','model','plugin','ai','combined','webpair'].includes(k)))
const cycles=Number(arg('--cycles',3)),port=Number(arg('--port',9464)),tag=arg('--tag','initial'),guestCdp=process.argv.includes('--guest-cdp')
assert.ok(Number.isInteger(cycles)&&cycles>0&&cycles<=30&&/^[a-z0-9-]+$/.test(tag))
assertPortFree(port)
const root=process.cwd(),out=path.join(root,'docs/verification/memory-attribution'),fixtures=path.join(root,'scratchpad/memory-attribution')
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(fixtures,{recursive:true});fs.writeFileSync(path.join(out,'.gitignore'),'*.local*\n')
const lock=path.join(out,'RUNNING.local');assert.ok(!fs.existsSync(lock));fs.writeFileSync(lock,String(process.pid),{flag:'wx'})
const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort())
const sleep=ms=>delay(ms,undefined,{signal:abort.signal}),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const nativeMapEnabled=process.argv.includes('--native-map'),memoryDumpEnabled=process.argv.includes('--memory-dump');
const results=[],started=Date.now();let current=null
function progress(phase){console.log(new Date().toISOString()+' '+phase);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({at:new Date().toISOString(),tag,phase,completed:results.length,total:kinds.length,elapsedSeconds:Math.round((Date.now()-started)/1000)},null,2));fs.writeFileSync(path.join(out,tag+'-summary.json'),JSON.stringify({sourceCommit,physicalMemoryBytes:os.totalmem(),guestCdp,results,current,elapsedSeconds:Math.round((Date.now()-started)/1000)},null,2))}
function table(){return execFileSync('/bin/ps',['-axo','pid=,ppid=,rss=,comm='],{encoding:'utf8'}).split('\n').flatMap(l=>{const m=l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);return m?[{pid:+m[1],parent:+m[2],bytes:+m[3]*1024,comm:m[4]}]:[]})}
function descendants(rows,pid){const set=new Set([pid]);for(let i=0;i<16;i++)for(const r of rows)if(set.has(r.parent))set.add(r.pid);return rows.filter(r=>set.has(r.pid))}
async function connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.j(Error(m.error.message)):p.r(m.result)}};const send=(method,params={})=>new Promise((r,j)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);j(Error('CDP timeout '+method))},20000);pending.set(id,{r,j,t});ws.send(JSON.stringify({id,method,params}))});return{ws,send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
const targets=(owner)=>{assertPortOwned(port,owner);return fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())}
async function until(fn,label){for(let i=0;i<80;i++){abort.signal.throwIfAborted();const v=await fn();if(v)return v;await sleep(500)}throw Error('Timed out '+label)}
const picture=path.join(fixtures,'image.png'),model=path.join(fixtures,'model.glb'),html=path.join(fixtures,'page.html')
const old=fs.readFileSync('scripts/verify-low-memory-workloads.mjs','utf8'),sphere=old.slice(old.indexOf('const positions=[]'),old.indexOf('const model=path.join'))
new Function('fs','model',sphere+'\nfs.writeFileSync(model,Buffer.concat([header,json,binHeader,bin]));')(fs,model)
fs.copyFileSync('docs/verification/low-memory/recovery-dark.png',picture)
fs.writeFileSync(html,'<!doctype html><html><head><meta charset="utf-8"><title>Attribution fixture</title></head><body>离线组件对照</body></html>')
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||['ELECTRON_RUN_AS_NODE','EAS_PTY_ID','EAS_PROJECT'].includes(k))delete env[k]
try{for(const kind of kinds){
 abort.signal.throwIfAborted();const r={kind,cycles,guestCdp,passed:false,samples:[],errors:[],events:[],cleanup:null};current=r
 let phase='launch',child,main,appPid,uiPids=new Set(),errorCarry='';const streams=[],log=fs.createWriteStream(path.join(out,tag+'-'+kind+'.local.log'))
 const event=(name)=>{phase=name;r.events.push({phase,at:new Date().toISOString()});progress(kind+' / '+phase)}
 try{
  child=spawn(process.execPath,['scripts/verify-app.mjs','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']})
  const onLog=b=>{log.write(b);errorCarry+=b.toString();const lines=errorCarry.split('\n');errorCarry=lines.pop();for(const l of lines)if(l.includes(':ERROR:')||/render-process-gone|unresponsive|crashed/i.test(l))r.errors.push({phase,at:new Date().toISOString(),message:l.replace(/^\[[^\]]+\]\s*/, '').slice(0,600)})};child.stdout.on('data',onLog);child.stderr.on('data',onLog)
  const page=await until(async()=>{if(child.exitCode!==null)throw Error('launcher exited');try{return(await targets(child.pid)).find(t=>t.type==='page'&&t.title==='Eas-Term')}catch{return null}},'main')
  main=await connect(page.webSocketDebuggerUrl);streams.push(main.ws);await until(()=>main.eval('Boolean(window.__easVerify&&window.__store&&window.api?.runtimeMonitor)'),'isolation')
  r.userAgent=await main.eval('navigator.userAgent')
  const own=descendants(table(),child.pid);appPid=own.find(x=>x.comm===path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))?.pid;assert.ok(appPid)
  uiPids=new Set(descendants(table(),appPid).filter(x=>x.comm.includes('Helper (Renderer)')).map(x=>x.pid))
  const sample=async()=>{const m=await main.eval('window.api.runtimeMonitor(true).then(m=>({processTree:m.processTree,processes:m.processes}))');const heap=await main.send('Runtime.getHeapUsage'),dom=await main.send('Memory.getDOMCounters');const roles={};for(const p of descendants(table(),appPid)){const role=p.pid===appPid?'main':p.comm.includes('Helper (GPU)')?'gpu':p.comm.includes('Helper (Renderer)')?(uiPids.has(p.pid)?'uiRenderer':'guestRenderer'):p.comm.includes('Electron Helper')?'utility':'otherChild';const v=roles[role]??{count:0,bytes:0};v.count++;v.bytes+=p.bytes;roles[role]=v}const s={phase,at:new Date().toISOString(),...m,roles,heap,dom,targetCount:(await targets(child.pid)).length};r.samples.push(s);fs.writeFileSync(path.join(out,tag+'-'+kind+'.json'),JSON.stringify(r,null,2));return s}
  let tracer,traceHandle;if(memoryDumpEnabled){const v=await fetch('http://127.0.0.1:'+port+'/json/version').then(x=>x.json());tracer=await connect(v.webSocketDebuggerUrl);streams.push(tracer.ws);tracer.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Tracing.tracingComplete')traceHandle=m.params.stream});await tracer.send('Tracing.start',{categories:'-*,disabled-by-default-memory-infra',transferMode:'ReturnAsStream'});r.memoryDumps=[]}
  const memoryDump=async(label)=>{if(!memoryDumpEnabled)return;const d=await tracer.send('Tracing.requestMemoryDump',{deterministic:false,levelOfDetail:'detailed'});r.memoryDumps.push({label,...d});assert.equal(d.success,true)}
  const nativeMap=async(label)=>{if(!nativeMapEnabled)return; r.nativeMaps??=[];for(const proc of descendants(table(),appPid)){const role=proc.pid===appPid?'main':uiPids.has(proc.pid)?'uiRenderer':proc.comm.includes('Helper (GPU)')?'gpu':null;if(!role)continue;const filename=tag+'-'+kind+'-'+label+'-'+role+'.local.vmmap.txt';try{const output=execFileSync('/usr/bin/vmmap',['-summary',String(proc.pid)],{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});fs.writeFileSync(path.join(out,filename),output);r.nativeMaps.push({label,role,file:filename,ok:true,at:new Date().toISOString()})}catch(e){r.nativeMaps.push({label,role,ok:false,error:String(e.message).slice(0,250)})}}fs.writeFileSync(path.join(out,tag+'-'+kind+'.json'),JSON.stringify(r,null,2))}
  const observe=async(name,seconds)=>{event(name);await sample();for(let i=0;i<seconds/6;i++){await sleep(6000);await sample()}}
  const frame={id:'attr-frame',projectId:'p-verify',name:'同布局对照',x:10,y:10,w:1540,h:920,collapsed:false,nodes:[]}
  const setNodes=async nodes=>main.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",maximizedNode:null,canvasSel:[],canvas:{...s.canvas,viewport:{x:0,y:0,scale:0.65},frames:['+JSON.stringify({...frame,nodes})+'],freeNodes:[]}});return true})()')
  await main.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",tabs:[],activeTabId:null,canvas:{...s.canvas,frames:[],freeNodes:[]}});return true})()')
  if(kind==='model'||kind==='combined'||kind==='webpair'){const dep=await main.eval('window.api.modelDep.status()');if(!dep.installed)assert.equal((await main.eval('window.api.modelDep.download()')).ok,true)}
  await observe('blank',12);await setNodes([]);await observe('baseline',12);await nativeMap('baseline');await memoryDump('baseline')
  const nodes={image:{id:'attr-image',x:10,y:30,w:740,h:410,pane:{kind:'image',filePath:picture}},model:{id:'attr-model',x:780,y:30,w:740,h:410,pane:{kind:'image',filePath:model}},html:{id:'attr-html',x:10,y:480,w:740,h:410,pane:{kind:'web',url:pathToFileURL(html).href}},plugin:{id:'attr-plugin',x:780,y:480,w:740,h:410,component:{type:'plugin-panel',props:{pluginId:'eas:execution-plan',panelId:'main'}}}}
  for(let i=1;i<=cycles;i++){
   event('open-'+i)
   if(kind==='ai'){
    const ns=Array.from({length:3},(_,j)=>({id:'attr-agent-'+j,leafId:'attr-leaf-'+j,x:10+j*490,y:30,w:470,h:750}));const tabs=ns.map((n,j)=>({id:'attr-tab-'+j,title:'Idle AI',cwd:root,projectId:'p-verify',activeLeafId:n.leafId,root:{type:'leaf',id:n.leafId,pane:{kind:'agent',cli:'claude',cwd:root}}}));await main.eval('window.__store.setState({tabs:'+JSON.stringify(tabs)+',activeTabId:"attr-tab-0"})');await setNodes(ns);await until(()=>main.eval('document.querySelectorAll(".agent-chat-view").length===3'),'idle ai')
   }else await setNodes(kind==='combined'?Object.values(nodes):kind==='webpair'?[nodes.model,nodes.html]:nodes[kind]?[nodes[kind]]:[])
   if(kind==='image'||kind==='combined')await until(()=>main.eval('[...document.querySelectorAll(".cfile-body img")].some(i=>i.complete&&i.naturalWidth>0)'),'image')
   if(kind==='plugin'||kind==='combined')await until(()=>main.eval('!!document.querySelector(".plg-frame")'),'plugin')
   for(const [k,selector,expression] of [['model','webview.model-frame','Boolean(document.querySelector("model-viewer")?.loaded)'],['html','webview.web-frame','document.body.innerText.includes("离线组件对照")']])if(kind===k||kind==='combined'||kind==='webpair'){
    if(guestCdp){const t=await until(async()=>(await targets(child.pid)).find(t=>k==='model'?t.url.startsWith('easmodel://'):t.url===pathToFileURL(html).href),'guest');const c=await connect(t.webSocketDebuggerUrl);streams.push(c.ws);await until(()=>c.eval(expression),'guest loaded');c.ws.close()}
    else await until(async()=>{try{return await main.eval('(async()=>{const w=document.querySelector('+JSON.stringify(selector)+');return w?await w.executeJavaScript('+JSON.stringify(expression)+'):false})()')}catch{return false}},'guest loaded without CDP')
   }
   if(i===1){const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,tag+'-'+kind+'.png'),Buffer.from(shot.data,'base64'))}
   await observe('active-'+i,6);if(i===1){await nativeMap('active-first');await memoryDump('active-first')}event('closing-'+i)
   await main.eval('(()=>{const s=window.__store.getState();for(const f of s.canvas.frames)for(const n of f.nodes)s.removeNode(f.id,n.id);window.__store.setState({tabs:[],activeTabId:null});return true})()');await setNodes([])
   await until(()=>main.eval('document.querySelectorAll("webview,.plg-frame,.agent-chat-view,.cfile-body img").length===0'),'guest removed')
   await observe('closed-'+i,12)
  }
  await observe('final-natural',18);await nativeMap('natural');await memoryDump('natural')
  // Diagnostic only, after ALL natural measurements. Not an optimization or throughput result.
  event('diagnostic-gc');await main.send('HeapProfiler.collectGarbage');await observe('post-diagnostic-gc',6);await nativeMap('after-gc');await memoryDump('after-gc');if(process.argv.includes('--pressure-probe')){assert.ok(memoryDumpEnabled,'pressure probe requires trace');for(const level of ['moderate','critical']){await tracer.send('Memory.simulatePressureNotification',{level});await observe('diagnostic-pressure-'+level,6);await memoryDump('pressure-'+level)}}if(memoryDumpEnabled){await tracer.send('Tracing.end');for(let i=0;i<120&&!traceHandle;i++)await sleep(500);assert.ok(traceHandle,'browser trace completion timeout');const traceFile=path.join(out,tag+'-'+kind+'.local.trace.json'),fd=fs.openSync(traceFile,'w');let bytes=0;try{while(true){const chunk=await tracer.send('IO.read',{handle:traceHandle,size:1024*1024});const data=chunk.base64Encoded?Buffer.from(chunk.data,'base64'):Buffer.from(chunk.data);bytes+=data.length;assert.ok(bytes<64*1024*1024,'trace exceeds 64MiB diagnostic cap');fs.writeSync(fd,data);if(chunk.eof)break}}finally{fs.closeSync(fd);await tracer.send('IO.close',{handle:traceHandle})}r.traceExportBytes=bytes;r.traceEventCount=JSON.parse(fs.readFileSync(traceFile,'utf8')).traceEvents.length}

  const end=p=>r.samples.filter(s=>s.phase===p).at(-1);r.summary={baseline:end('baseline'),natural:end('final-natural'),afterGc:end('post-diagnostic-gc'),closed:Array.from({length:cycles},(_,i)=>end('closed-'+(i+1)))}
  r.passed=true
 }catch(e){r.error=String(e);process.exitCode=1}
 finally{
  for(const ws of streams)ws.close();const owned=appPid?descendants(table(),appPid).map(x=>x.pid):[]
  if(child&&child.exitCode===null){const ended=new Promise(v=>child.once('exit',v));child.kill('SIGINT');await Promise.race([ended,delay(10000)])}
  let remaining=[];for(let i=0;i<20;i++){const alive=new Set(table().map(x=>x.pid));remaining=owned.filter(x=>alive.has(x));if(!remaining.length)break;await delay(250)}
  r.cleanup={launcherExited:Boolean(child&&(child.exitCode!==null||child.signalCode!==null)),remainingOwnedCount:remaining.length};if(!r.cleanup.launcherExited||remaining.length){r.passed=false;r.error='owned diagnostic process did not exit';process.exitCode=1}log.end();fs.writeFileSync(path.join(out,tag+'-'+kind+'.json'),JSON.stringify(r,null,2));results.push(r);current=null;progress(kind+(r.passed?' complete':' FAILED'));if(!r.passed)break
 }
}}finally{for(const file of[picture,model,html])fs.rmSync(file,{force:true});fs.rmSync(lock,{force:true});current=null;progress('finished');}
