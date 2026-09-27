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
const out=path.join(root,'docs/verification/cli-dispatch');fs.mkdirSync(out,{recursive:true})
const port=9571,env={...process.env};for(const k of ['ELECTRON_RUN_AS_NODE','EAS_TERM_PORT','EAS_TERM_TOKEN','EAS_PTY_ID','EAS_PROJECT'])delete env[k]
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'unique patch anchor');return s.replace(a,b)}
let patched=replace(original,"import {cliTurnQueue,", "import {admitCliTurn} from './cliDispatch.ts'\nimport {cliTurnQueue,")
patched=replace(patched,' const stopGate=createStopGate()'," let verifyQueued=false;const verifyStarts:{name:string;at:number}[]=[]\n const stopGate=createStopGate()")
patched=replace(patched,'  return {cliConcurrency:cliTurnQueue.getLimit(),',`  if(process.env.EAS_VERIFY!=='1')throw Error('isolated fixture required')
  if(!verifyQueued){verifyQueued=true;for(const name of ['Claude A','Codex B','OMP C','Claude D']){let key='';void admitCliTurn({sessionId:name,windowId:event.sender.id,projectId:'verify-project',name,signal:new AbortController().signal,start:k=>{key=k;verifyStarts.push({name,at:performance.now()})},cancelRunning:()=>cliTurnQueue.finish(key)}).catch(()=>{})}}
  return {verifyStarts,verifyPersisted:runtimeStateStore.read().cliConcurrency??2,cliConcurrency:cliTurnQueue.getLimit(),`)
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
 await sleep(3500)
 let sample=await evaluate('window.api.runtimeMonitor()')
 assert.equal(sample.verifyStarts.length,2)
 assert.ok(sample.verifyStarts[1].at-sample.verifyStarts[0].at>=990)
 await shot('two-running-two-waiting')
 await click(`[...document.querySelectorAll('.rs-row')].find(r=>r.textContent.includes('OMP C')).querySelector('button')`)
 await sleep(400)
 sample=await evaluate('window.api.runtimeMonitor()')
 assert.equal(sample.tasks.filter(t=>t.name==='OMP C').length,0)
 await evaluate("(()=>{const s=document.querySelector('#cli-concurrency');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
 await sleep(400)
 sample=await evaluate('window.api.runtimeMonitor()');assert.equal(sample.cliConcurrency,1);assert.equal(sample.verifyPersisted,1);assert.equal(sample.verifyStarts.length,2)
 await evaluate("(()=>{const s=document.querySelector('#cli-concurrency');s.value='3';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
 await sleep(1200)
 sample=await evaluate('window.api.runtimeMonitor()');assert.equal(sample.cliConcurrency,3);assert.equal(sample.verifyPersisted,3);assert.equal(sample.verifyStarts.length,3)
 assert.equal(sample.verifyStarts[2].name,'Claude D')
 await sleep(3200)
 await evaluate("document.querySelector('#cli-concurrency').scrollIntoView({block:'center'})")
 await shot('changed-limit')
 await evaluate("window.__store.getState().setTheme('light')");await sleep(400);await shot('light')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,scope:'real Electron settings and real global queue; controlled jobs, not online model calls',sample},null,2))
 console.log('PASS: two active, staggered, cancel queued, change and persist limits, dark/light UI')
}finally{
 ws?.close()
 if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill('SIGINT');await Promise.race([exit,delay(6000)])}
 if(fs.readFileSync(file,'utf8')!==patched)throw Error('source changed concurrently; refusing to overwrite')
 fs.writeFileSync(file,original);build();fs.unlinkSync(backup)
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
 console.log('Source restored; production build rebuilt')
}
