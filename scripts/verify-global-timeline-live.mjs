// Opt-in real-model acceptance. Uses existing CLI login; never prints credentials.
if(process.env.EAS_TIMELINE_LIVE_ACCEPT!=='1')throw Error('Set EAS_TIMELINE_LIVE_ACCEPT=1 to authorize short real-model turns')
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {record} from '../resources/plugins/timeline/lib/store.mjs'
import {capture} from '../resources/plugins/timeline/lib/candidates.mjs'
import {spawn} from 'node:child_process'
const cliFilter=(process.env.EAS_TIMELINE_ACCEPT_CLIS||'codex,claude,omp').split(',');if(cliFilter.some(x=>!['codex','claude','omp'].includes(x)))throw Error('Unknown CLI');
const root=process.cwd(),output=path.join(root,'docs/verification/global-timeline-live'+(process.env.EAS_TIMELINE_ACCEPT_CLIS?'-'+cliFilter.join('-'):''));fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
const fixtureB=fs.mkdtempSync(path.join(os.tmpdir(),'eas-global-project-b-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'timeline-fixture',name:'Eas-Term',path:fixture},{id:'project-b',name:'笔纵画板',path:fixtureB}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const executable=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const policy='(version 1) (allow default) '+['.eas'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,root,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[],results=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}
try{
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 const main=await connect((await until(async()=>(await targets()).find(x=>x.type==='page'&&!x.url.includes('island')))).webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.__store && !!window.api?.plugins'))
 check(await main.eval("window.api.plugins.list().then(p=>p.some(x=>x.id==='eas:timeline'))"),'builtin plugin discovered')
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('timeline-fixture',30,30);const f=window.__store.getState().canvas.frames.find(x=>x.projectId==='timeline-fixture');window.__tlFrame=f.id;s.addComponentNode(f.id,'plugin-panel',20,20,850,680,{pluginId:'eas:timeline',panelId:'main'});s.setViewport({x:0,y:0,scale:0.78})})()")
 const panelTarget=await until(async()=>(await targets()).find(x=>x.type==='iframe'&&x.url.startsWith('eas-plugin:')))
 const panel=await connect(panelTarget.webSocketDebuggerUrl)
 await until(()=>panel.eval("document.querySelector('#connection')?.textContent.includes('全局 · 本地保存')"))

 const count=()=>{try{return JSON.parse(fs.readFileSync(path.join(fixture,'.eas/timeline-candidates.json'),'utf8')).items.length}catch{return 0}}
 async function turn(cli,id,message){
  await main.eval('window.__acceptEvents=[];window.__acceptOff?.()')
  let result
  if(!id){result=await main.eval(`window.api.agentChat.start(${JSON.stringify({cli,cwd:fixture,message,sandbox:'read-only'})})`);id=result.sessionId}
  else result=await main.eval(`window.api.agentChat.send(${JSON.stringify(id)},${JSON.stringify(message)})`)
  if(!result?.ok||!id)return {ok:false,error:result?.error||'start failed',id}
  await main.eval(`window.__acceptOff=window.api.agentChat.onEvent(${JSON.stringify(id)},e=>window.__acceptEvents.push(e))`)
  let events=[]
  for(let i=0;i<900;i++){events=await main.eval('window.__acceptEvents');if(events.some(e=>e.k==='turn.done'||e.k==='error'&&e.fatal))break;await wait(100)}
  const done=events.some(e=>e.k==='turn.done'),text=events.filter(e=>e.k==='text.done').map(e=>e.text).join('\n')
  return {ok:done&&!!text,id,text,errors:events.filter(e=>e.k==='error').map(e=>e.message||e.text||'error').slice(-3),events:events.map(e=>e.k)}
 }
 for(const cli of cliFilter){
  await panel.eval("rpc('panel/revoke',{})")
  const before=count(),hello=await turn(cli,null,'这是时间线验收的普通问答。不要调用任何工具，只回答：收到。')
  if(!hello.ok||!hello.text?.includes('收到')){results.push({cli,phase:'ordinary-turn',...hello,blocked:true});if(hello.id)await main.eval(`window.api.agentChat.stop(${JSON.stringify(hello.id)})`);continue}
  check(count()===before,cli+' ordinary chat while disabled does not capture')
  await panel.eval("rpc('panel/grant',{})")
  const done=await turn(cli,hello.id,'这是一个极小的计算交付任务。不要调用任何工具：计算 17 加 25。答复只用一行，以「已完成」开头并给出算式和结果。')
  await wait(1200)
  results.push({cli,phase:'enabled-existing-session',...done,candidateDelta:count()-before})
  if(done.ok&&count()===before+1)checks.push(cli+' existing non-timeline session automatically captures candidate')
  await main.eval(`window.api.agentChat.stop(${JSON.stringify(hello.id)})`)
 }
 await panel.eval("document.querySelector('#refresh').click()")
 await wait(1000)
 await panel.eval("document.querySelector('#candidateButton').click()")
 await wait(600)
 await main.send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(output,'live-candidates.png'),Buffer.from(r.data,'base64')))
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,results},null,2));if(results.some(r=>!r.ok||r.candidateDelta!==1))process.exitCode=1
 console.log(JSON.stringify({checks,results},null,2))
}catch(e){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,results,error:String(e)},null,2));console.error(e);process.exitCode=1}finally{for(const ws of sockets)ws.close();child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100});await fs.promises.rm(fixtureB,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
