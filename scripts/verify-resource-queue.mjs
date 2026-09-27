// Real Electron UI + real scheduler, controlled resource gate, no CLI/network workload.
// Temporarily inject bounded test jobs into main, always restore and rebuild afterward.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
const stop=new AbortController()
const sleep=ms=>delay(ms,undefined,{signal:stop.signal})
const root=process.cwd(),file=path.join(root,'src/main/runtime/ipc.ts'),original=fs.readFileSync(file,'utf8')
const out=path.join(root,'docs/verification/resource-queue');fs.mkdirSync(out,{recursive:true})
const port=9457,env={...process.env};for(const k of ['ELECTRON_RUN_AS_NODE','EAS_TERM_PORT','EAS_TERM_TOKEN','EAS_PTY_ID','EAS_PROJECT'])delete env[k]
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'unique patch anchor');return s.replace(a,b)}
let patched=replace(original,"import {createProcessMetricsReader}","import {runManagedTask} from './sessionStartup.ts'\nimport {createProcessMetricsReader}")
patched=replace(patched,' const stopGate=createStopGate()'," let verifyQueued=false;const verifyStarts:Record<string,number>={A:0,B:0}\n const stopGate=createStopGate()")
patched=replace(patched,' controller.start()'," if(process.env.EAS_VERIFY!=='1')throw Error('verification instance required')\n const verifyTick=setInterval(()=>controller.manager.tick(),250)\n app.once('before-quit',()=>clearInterval(verifyTick))")
patched=replace(patched,'  controller.setMode(next)',"  controller.setMode(next)\n  if(next==='normal')controller.manager.setEnforcement(false)")
patched=replace(patched,'  return {...controller.readForControl(),',`  if(!verifyQueued){verifyQueued=true;for(const id of ['A','B'])void runManagedTask({id:'verify-queue-'+id,windowId:event.sender.id,projectId:null,name:'排队验收 '+id,cost:{cpu:1,memoryBytes:1024},start:async()=>{verifyStarts[id]++;return {result:Promise.resolve(),completed:Promise.resolve()}}}).catch(()=>{})}
  return {verifyStarts:{...verifyStarts},...controller.readForControl(),`)
const backup=path.join(out,'ipc-source-backup.local')
assert.ok(!fs.existsSync(backup),'previous verification recovery backup exists; inspect before retrying')
let child,ws,seq=0;const pending=new Map()
const interrupt=()=>stop.abort()
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt)
const build=()=>{const log=fs.openSync(path.join(out,'build-local.log'),'w');try{const r=spawnSync('npm',['run','build'],{cwd:root,env,stdio:['ignore',log,log]});assert.equal(r.status,0,'build failed: see local log')}finally{fs.closeSync(log)}}
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params}))})
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const click=async expression=>{const p=await evaluate(`(()=>{const el=${expression};if(!el)throw Error('missing click target');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await sleep(400)}
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
try{
 fs.writeFileSync(backup,original,{flag:'wx'});fs.writeFileSync(file,patched);build()
 stop.signal.throwIfAborted()
 const log=fs.openSync(path.join(out,'app-local.log'),'w')
 child=spawn(process.execPath,['scripts/verify-app.mjs','--port',String(port)],{cwd:root,env,stdio:['ignore',log,log]});fs.closeSync(log)
 let page
 for(let i=0;i<60;i++){await sleep(500);try{page=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.title==='Eas-Term');if(page)break}catch{}}
 assert.ok(page,'isolated app did not start')
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}
 assert.equal(await evaluate('Boolean(window.__easVerify)'),true)
 await click('document.querySelector(\'button[data-tip="设置"]\')')
 await click(`[...document.querySelectorAll('.cset-tab')].find(b=>b.textContent.includes('运行'))`)
 const samples=[]
 for(let i=0;i<8;i++){
  if(i)await sleep(10000)
  const s=await evaluate('window.api.runtimeMonitor()')
  const own=s.tasks.filter(t=>t.id.startsWith('verify-queue-'))
  assert.equal(own.length,2);assert.ok(own.every(t=>t.state==='queued'));assert.deepEqual(s.verifyStarts,{A:0,B:0})
  samples.push({elapsedMs:own[0].ageMs,queued:own.length,starts:s.verifyStarts})
  console.log('Queue still waiting: '+Math.round(own[0].ageMs/1000)+'s')
 }
 assert.ok(samples.at(-1).elapsedMs>65000)
 await shot('waiting-over-60s')
 await click(`[...document.querySelectorAll('.rs-row')].find(r=>r.textContent.includes('排队验收 B')).querySelector('button')`)
 let s=await evaluate('window.api.runtimeMonitor()');assert.equal(s.tasks.filter(t=>t.id.startsWith('verify-queue-')).length,1)
 await click(`[...document.querySelectorAll('[aria-label="资源模式"] button')].find(b=>b.textContent.includes('普通'))`)
 await sleep(1000);s=await evaluate('window.api.runtimeMonitor()')
 assert.deepEqual(s.verifyStarts,{A:1,B:0});assert.equal(s.tasks.filter(t=>t.id.startsWith('verify-queue-')).length,0)
 assert.ok(s.recent.some(t=>t.id==='verify-queue-A'&&t.outcome==='done'));assert.ok(s.recent.some(t=>t.id==='verify-queue-B'&&t.outcome==='cancelled'))
 await shot('released-and-cancelled')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,scope:'real scheduler and UI; controlled resource gate; no model call',samples,finalStarts:s.verifyStarts},null,2))
 console.log('PASS: >60s waiting, UI cancellation, gate recovery starts A once and B never')
}finally{
 ws?.close()
 if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill('SIGINT');await Promise.race([exit,delay(6000)])}
 if(fs.readFileSync(file,'utf8')!==patched)throw Error('source changed concurrently; refusing to overwrite')
 fs.writeFileSync(file,original);build();fs.unlinkSync(backup)
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
 console.log('Source restored; production build rebuilt')
}
