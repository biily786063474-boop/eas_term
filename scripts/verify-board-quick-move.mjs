// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/board-quick-move');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
const fixtureB=fs.mkdtempSync(path.join(os.tmpdir(),'eas-global-project-b-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'timeline-fixture',name:'Eas-Term',path:fixture},{id:'project-b',name:'笔纵画板',path:fixtureB}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'board.json'),JSON.stringify({version:1,columns:[{id:'todo',name:'待执行'},{id:'doing',name:'进行中'},{id:'review',name:'等待验收'}]}));
const executable=process.env.EAS_VERIFY_EXECUTABLE||path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,...(process.env.EAS_VERIFY_EXECUTABLE?[]:[root]),'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}
try{
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 const main=await connect((await until(async()=>(await targets()).find(x=>x.type==='page'&&!x.url.includes('island')))).webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.__store'));await wait(1500);await main.send('Page.bringToFront')
 await main.eval("window.__store.getState().setViewMode('board')")
 await until(()=>main.eval("!!document.querySelector('.board-card[data-project-id=\"timeline-fixture\"]')"))
 const open=async()=>{
  const r=await main.eval("(()=>{const r=document.querySelector('.board-card[data-project-id=\"timeline-fixture\"]').getBoundingClientRect();return {x:r.left+40,y:r.top+30}})()")
  await main.send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'right',buttons:2,clickCount:1});await main.send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'right',buttons:0,clickCount:1})
  await until(()=>main.eval("[...document.querySelectorAll('.cctx-label')].some(e=>e.textContent==='移动到看板区')"))
  const p=await main.eval("(()=>{const r=[...document.querySelectorAll('.cctx-item')].find(e=>e.textContent.includes('移动到看板区')).getBoundingClientRect();return {x:r.left+50,y:r.top+r.height/2}})()")
  await main.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await until(()=>main.eval("!!document.querySelector('.cctx-sub')"))
 }
 await open()
 check(await main.eval("[...document.querySelectorAll('.cctx-sub .cctx-label')].some(e=>e.textContent==='等待验收')"),'user-defined destinations appear in right-click submenu')
 const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'menu.png'),Buffer.from(shot.data,'base64'))
 await main.eval("[...document.querySelectorAll('.cctx-sub .cctx-item')].find(e=>e.textContent.includes('等待验收')).click()")
 await until(()=>main.eval("document.querySelector('.board-col.st-review .board-card[data-project-id=\"timeline-fixture\"]')!==null"))
 check(true,'click instantly moves the entire project card into destination column')
 await until(()=>JSON.parse(fs.readFileSync(path.join(profile,'projects.json'),'utf8')).find(p=>p.id==='timeline-fixture').status==='review')
 check(true,'destination persisted using real projects IPC')
 await open();check(await main.eval("[...document.querySelectorAll('.cctx-sub .cctx-item')].find(e=>e.textContent.includes('等待验收')).disabled"),'current destination disabled, cannot accidentally unclassify')
 await main.eval("[...document.querySelectorAll('.cctx-sub .cctx-item')].find(e=>e.textContent.includes('未分类')).click()")
 await until(()=>main.eval("!window.__store.getState().projects.find(p=>p.id==='timeline-fixture').status"))
 check(await main.eval("!window.__store.getState().boardFullscreen"),'right click never opens project session')
 await until(()=>!JSON.parse(fs.readFileSync(path.join(profile,'projects.json'),'utf8')).find(p=>p.id==='timeline-fixture').status)
 await main.eval('location.reload()');await until(()=>main.eval("!!window.__store&&document.querySelectorAll('.board-card').length===2"))
 check(await main.eval("!window.__store.getState().projects.find(p=>p.id==='timeline-fixture').status"),'unclassified move survives reload')
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}))
}catch(e){process.exitCode=1;console.error(e);fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))}
finally{for(const ws of sockets)ws.close();child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');fs.writeFileSync(path.join(output,'app.log'),logs);for(const dir of [profile,fixture,fixtureB])await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
