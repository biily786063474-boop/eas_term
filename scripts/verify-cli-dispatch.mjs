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
patched=replace(patched,' const stopGate=createStopGate()'," let verifyOffline=true;let verifyQueued=false;const verifyStarts:{name:string;at:number}[]=[]\n const stopGate=createStopGate()")
patched=replace(patched,'  return {idleRecoveryEnabled:idleEnabled,idleMemory:idleMemory.status(),cliNetwork:cliTurnQueue.networkStatus(),cliConcurrency:cliTurnQueue.getLimit(),',`  if(process.env.EAS_VERIFY!=='1')throw Error('isolated fixture required')
  if(!verifyQueued){verifyQueued=true;for(const name of ['Claude A','Codex B','OMP C','Claude D','Extra E','Extra F','Extra G','Extra H','Extra I','Cancel E']){let key='';void admitCliTurn({sessionId:name,windowId:event.sender.id,projectId:name==='Claude D'?'later-project':'verify-project',name,signal:new AbortController().signal,start:k=>{key=k;verifyStarts.push({name,at:performance.now()})},cancelRunning:()=>cliTurnQueue.finish(key)}).catch(()=>{})}}
  return {idleRecoveryEnabled:idleEnabled,idleMemory:idleMemory.status(),cliNetwork:cliTurnQueue.networkStatus(),verifyStarts,verifyPersisted:runtimeStateStore.read().cliConcurrency??2,cliConcurrency:cliTurnQueue.getLimit(),`)
patched=replace(patched,'const sampleNetwork=()=>cliTurnQueue.setOnline(net.isOnline())','const sampleNetwork=()=>cliTurnQueue.setOnline(!verifyOffline)')
patched=replace(patched,"  void value\n  throw Error('已改为首次发送错峰，不再设置运行任务并发数')",`  if(process.env.EAS_VERIFY!=='1')throw Error('fixture only')
  if(value===901){verifyOffline=false;sampleNetwork()}
  else if(value===902){const key=cliTurnQueue.snapshot().find(x=>x.state==='running')?.key;if(key)cliTurnQueue.networkFailure(key,'rate-limit')}
  return {cliConcurrency:0}`)
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
 await sleep(1200)
 let offline=await evaluate('window.api.runtimeMonitor()')
 assert.equal(offline.verifyStarts.length,0)
 assert.equal(offline.cliNetwork.offline,true)
 assert.ok(await evaluate("document.querySelector('.rs-page').textContent.includes('等待网络恢复')"))
 await shot('adaptive-offline')
 await evaluate('window.api.runtimeSetIdleRecovery(false)')
 assert.equal((await evaluate('window.api.runtimeMonitor()')).idleRecoveryEnabled,false)
 await evaluate('window.api.runtimeSetIdleRecovery(true)')
 assert.equal((await evaluate('window.api.runtimeMonitor()')).idleRecoveryEnabled,true)
 await evaluate('window.api.runtimeSetCliConcurrency(901)')
 await sleep(1300)
 assert.equal((await evaluate('window.api.runtimeMonitor()')).verifyStarts.length,0,'recovery does not burst')
 await sleep(5700)
 let sample=await evaluate('window.api.runtimeMonitor()')
 assert.ok(sample.verifyStarts.length>=3)
 assert.ok(sample.verifyStarts[1].at-sample.verifyStarts[0].at>=990)
 await shot('send-only-stagger')
 await click(`[...document.querySelectorAll('.rs-row')].find(r=>r.textContent.includes('Cancel E')).querySelector('button')`)
 await sleep(400)
 sample=await evaluate('window.api.runtimeMonitor()')
 assert.equal(sample.tasks.filter(t=>t.name==='Cancel E').length,0)
 assert.equal(await evaluate("!!document.querySelector('#cli-concurrency')"),false)
 assert.equal(sample.verifyStarts[2].name,'OMP C')
 await sleep(17000)
 sample=await evaluate('window.api.runtimeMonitor()')
 assert.equal(sample.verifyStarts.length,9,'all uncancelled tasks start without any running task completing')
 assert.equal(sample.tasks.filter(t=>t.state==='running').length,9)
 for(let i=1;i<sample.verifyStarts.length;i++)assert.ok(sample.verifyStarts[i].at-sample.verifyStarts[i-1].at>=990)
 assert.deepEqual(sample.verifyStarts.map(x=>x.name),['Claude A','Codex B','OMP C','Claude D','Extra E','Extra F','Extra G','Extra H','Extra I'])
 await shot('send-only-all-running')
 await evaluate('window.api.runtimeSetCliConcurrency(902)')
 sample=await evaluate('window.api.runtimeMonitor()')
 assert.equal(sample.cliNetwork.intervalMs,4000)
 await sleep(3500)
 if(!await evaluate("!!document.querySelector('.rs-modebar')")){
  await click('document.querySelector(\'button[data-tip="设置"]\')')
  await click(`[...document.querySelectorAll('.cset-tab')].find(b=>b.textContent.includes('运行'))`)
 }
 await evaluate("document.querySelector('.rs-modebar').scrollIntoView({block:'center'})")
 await shot('adaptive-backoff')
 await evaluate("window.__store.getState().setTheme('light')");await sleep(400);await shot('light')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,scope:'real Electron settings and real global queue; controlled jobs, not online model calls',sample},null,2))
 console.log('PASS: nine active without completion, FIFO stagger, cancel queued, dark/light UI')
}finally{
 ws?.close()
 if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill('SIGINT');await Promise.race([exit,delay(6000)])}
 if(fs.readFileSync(file,'utf8')!==patched)throw Error('source changed concurrently; refusing to overwrite')
 fs.writeFileSync(file,original);build();fs.unlinkSync(backup)
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
 console.log('Source restored; production build rebuilt')
}
