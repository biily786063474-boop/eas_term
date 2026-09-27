// Real Electron UI + real scheduler, controlled resource gate, no CLI/network workload.
// Temporarily inject bounded test jobs into main, always restore and rebuild afterward.
import {assertPortFree,assertPortOwned} from './lib/diagnostic-safety.mjs'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn,spawnSync,execFileSync} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
const stop=new AbortController()
const sleep=ms=>delay(ms,undefined,{signal:stop.signal})
const root=process.cwd(),file=path.join(root,'src/main/runtime/ipc.ts'),original=fs.readFileSync(file,'utf8')
const out=path.join(root,'docs/verification/pressure-recovery/queue');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'.gitignore'),'*.local*\n*local.log\n');const verification={passed:false,events:[]};const progress=phase=>{verification.events.push({phase,at:new Date().toISOString()});fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({phase,at:new Date().toISOString()},null,2));console.log(phase)}
const port=9473,env={...process.env};for(const k of ['ELECTRON_RUN_AS_NODE','EAS_TERM_PORT','EAS_TERM_TOKEN','EAS_PTY_ID','EAS_PROJECT'])delete env[k]
assertPortFree(port)
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'unique patch anchor');return s.replace(a,b)}
let patched=replace(original,"import {createProcessMetricsReader}","import {runManagedTask} from './sessionStartup.ts'\nimport {createProcessMetricsReader}")
patched=replace(patched,' const stopGate=createStopGate()'," let verifyQueued=false;const verifyStarts:Record<string,number>={A:0,B:0,C:0};const verifyOrder:string[]=[]\n const stopGate=createStopGate()")
patched=replace(patched,' controller.start()'," if(process.env.EAS_VERIFY!=='1')throw Error('verification instance required')\n const verifyTick=setInterval(()=>controller.manager.tick(),250)\n app.once('before-quit',()=>clearInterval(verifyTick))")
patched=replace(patched,'  controller.setMode(next)',"  controller.setMode(next)\n  if(next==='normal')controller.manager.setEnforcement(false)")
patched=replace(patched,'  return {...controller.readForControl(),',`  if(!verifyQueued){verifyQueued=true;for(const id of ['A','B','C'])void runManagedTask({id:'verify-queue-'+id,windowId:event.sender.id,projectId:null,name:'排队验收 '+id,cost:{cpu:1,memoryBytes:1024},start:async()=>{verifyStarts[id]++;verifyOrder.push(id);return {result:Promise.resolve(),completed:Promise.resolve()}}}).catch(()=>{})}
  return {verifyOrder:[...verifyOrder],verifyStarts:{...verifyStarts},...controller.readForControl(),`)
const backup=path.join(out,'ipc-source-backup.local')
assert.ok(!fs.existsSync(backup),'previous verification recovery backup exists; inspect before retrying')
let child,ws,bws,seq=0,bseq=0;const bpending=new Map();const pending=new Map()
const browserSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++bseq,t=setTimeout(()=>{bpending.delete(id);reject(Error('browser timeout'))},15000);bpending.set(id,{resolve:v=>{clearTimeout(t);resolve(v)},reject:e=>{clearTimeout(t);reject(e)}});bws.send(JSON.stringify({id,method,params}))});
const owned=new Set();const rows=()=>execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));const remember=()=>{if(!child)return;owned.add(child.pid);const all=rows();for(let i=0;i<16;i++)for(const [pid,parent]of all)if(owned.has(parent))owned.add(pid)};
const interrupt=()=>stop.abort()
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt)
let builds=0;const build=()=>{const log=fs.openSync(path.join(out,'build-'+(++builds)+'.local.log'),'w');try{const r=spawnSync('npm',['run','build'],{cwd:root,env,stdio:['ignore',log,log]});assert.equal(r.status,0,'build failed: see local log')}finally{fs.closeSync(log)}}
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params}))})
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const click=async expression=>{
 await evaluate(`(()=>{const el=${expression};if(!el)throw Error('missing click target');el.scrollIntoView({block:'center',behavior:'instant'});return true})()`)
 let p,previous
 for(let i=0;i<30;i++){
  await sleep(100);p=await evaluate(`(()=>{const el=${expression};if(!el)throw Error('click target disappeared');const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:hit?.className,ready:!!hit&&(el===hit||el.contains(hit))}})()`)
  if(p.ready&&previous&&Math.abs(p.x-previous.x)<.5&&Math.abs(p.y-previous.y)<.5)break
  previous=p;if(i===29)throw Error('click target not stable/hittable: '+JSON.stringify(p))
 }
 verification.clicks??=[];verification.clicks.push({expression,...p});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});await sleep(400)
}
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
try{
 progress('build controlled queue fixture');fs.writeFileSync(backup,original,{flag:'wx'});fs.writeFileSync(file,patched);build()
 stop.signal.throwIfAborted()
 const log=fs.openSync(path.join(out,'app-local.log'),'w')
 child=spawn(process.execPath,['scripts/verify-app.mjs','--port',String(port)],{cwd:root,env,stdio:['ignore',log,log]});fs.closeSync(log)
 let page
 for(let i=0;i<60;i++){await sleep(500);try{assertPortOwned(port,child.pid);page=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.title==='Eas-Term');if(page)break}catch{}}
 assert.ok(page,'isolated app did not start')
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}
 assert.equal(await evaluate('Boolean(window.__easVerify)'),true)
 const bv=await fetch('http://127.0.0.1:'+port+'/json/version').then(r=>r.json());bws=new WebSocket(bv.webSocketDebuggerUrl);await new Promise((yes,no)=>{bws.onopen=yes;bws.onerror=no});bws.onmessage=e=>{const m=JSON.parse(e.data),p=bpending.get(m.id);if(p){bpending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await click('document.querySelector(\'button[data-tip="设置"]\')')
 await click(`[...document.querySelectorAll('.cset-tab')].find(b=>b.textContent.includes('运行'))`)
 for(let i=0;i<40;i++){if(await evaluate('document.querySelectorAll(".rs-row").length===3'))break;if(i===39)throw Error('runtime settings did not become ready');await sleep(100)}
 const samples=[]
 for(let i=0;i<8;i++){
  if(i)await sleep(10000)
  if(i===2||i===4){const level=i===2?'moderate':'critical';progress('queued / '+level+' memory notification');await browserSend('Memory.simulatePressureNotification',{level})}
  assert.equal(await evaluate('Boolean(document.querySelector(".rs-row"))'),true,'runtime settings must remain mounted');remember();const s=await evaluate('window.api.runtimeMonitor()')
  const own=s.tasks.filter(t=>t.id.startsWith('verify-queue-'))
  assert.equal(own.length,3);assert.ok(own.every(t=>t.state==='queued'));assert.deepEqual(s.verifyStarts,{A:0,B:0,C:0})
  samples.push({elapsedMs:own[0].ageMs,queued:own.length,starts:s.verifyStarts})
  progress('Queue still waiting: '+Math.round(own[0].ageMs/1000)+'s')
 }
 assert.ok(samples.at(-1).elapsedMs>=70000)
 await shot('waiting-over-60s')
 await click(`[...document.querySelectorAll('.rs-row')].find(r=>r.textContent.includes('排队验收 B')).querySelector('button')`)
 let s=await evaluate('window.api.runtimeMonitor()');assert.equal(s.tasks.filter(t=>t.id.startsWith('verify-queue-')).length,2)
 await click(`[...document.querySelectorAll('[aria-label="资源模式"] button')].find(b=>b.textContent.includes('普通'))`)
 await sleep(1000);s=await evaluate('window.api.runtimeMonitor()')
 assert.deepEqual(s.verifyStarts,{A:1,B:0,C:1});assert.equal(s.tasks.filter(t=>t.id.startsWith('verify-queue-')).length,0)
 assert.ok(s.recent.some(t=>t.id==='verify-queue-A'&&t.outcome==='done'));assert.ok(s.recent.some(t=>t.id==='verify-queue-B'&&t.outcome==='cancelled'))
 await shot('released-and-cancelled')
 assert.deepEqual(s.verifyOrder,['A','C']);await sleep(10000);const late=await evaluate('window.api.runtimeMonitor()');assert.deepEqual(late.verifyStarts,{A:1,B:0,C:1});assert.deepEqual(late.verifyOrder,['A','C']);
 Object.assign(verification,{passed:true,scope:'real scheduler/UI with controlled resource gate; simulated engine memory notifications, no real OS pressure or model call',samples,finalStarts:late.verifyStarts,order:late.verifyOrder});
 progress('PASS: queued >70s across moderate/critical; cancel B; A/C start once in order; 10s no duplicate');

}catch(e){verification.passed=false;verification.error=String(e);process.exitCode=1;progress('FAILED: '+String(e))}finally{
 ws?.close();bws?.close();remember()
 if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill('SIGINT');await Promise.race([exit,delay(6000)])}
 let remaining=[];for(let i=0;i<20;i++){const alive=new Set(rows().map(x=>x[0]));remaining=[...owned].filter(p=>alive.has(p));if(!remaining.length)break;await delay(250)}verification.remainingOwnedCount=remaining.length;if(remaining.length){verification.passed=false;process.exitCode=1}
 if(fs.readFileSync(file,'utf8')!==patched)throw Error('source changed concurrently; refusing to overwrite')
 fs.writeFileSync(file,original);progress('restore production source and rebuild');build();fs.unlinkSync(backup);verification.sourceRestored=fs.readFileSync(file,'utf8')===original;verification.rebuildPassed=true;verification.launcherExited=Boolean(child&&(child.exitCode!==null||child.signalCode!==null));if(!verification.launcherExited){verification.passed=false;process.exitCode=1}fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(verification,null,2));progress('finished')
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
 console.log('Source restored; production build rebuilt')
}
