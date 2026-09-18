// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {record} from '../resources/plugins/timeline/lib/store.mjs'
import {capture} from '../resources/plugins/timeline/lib/candidates.mjs'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=path.join(root,'docs/verification/global-timeline-restart');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
const fixtureB=fs.mkdtempSync(path.join(os.tmpdir(),'eas-global-project-b-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'timeline-fixture',name:'Eas-Term',path:fixture},{id:'project-b',name:'笔纵画板',path:fixtureB}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const executable=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
let child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,root,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
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

 await panel.eval("rpc('panel/grant',{excluded:['project-b']})")
 const now=new Date(),date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')
 record(fixture,{taskKey:'restart',title:'重启持久化测试',summary:'真实应用重启验收夹具',date})
 for(const ws of sockets)ws.close()
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(3000)])
 if(child.exitCode===null&&child.signalCode===null)throw Error('Original isolated app did not exit')
 fs.rmSync(path.join(profile,'DevToolsActivePort'),{force:true})
 child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,root,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x)
 const newPort=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error('Relaunch exited')}})
 const newTargets=async()=>await(await fetch('http://127.0.0.1:'+newPort+'/json/list')).json()
 const newMain=await connect((await until(async()=>(await newTargets()).find(x=>x.type==='page'&&!x.url.includes('island')))).webSocketDebuggerUrl)
 await until(()=>newMain.eval('!!window.__store && !!window.api?.plugins'))
 await newMain.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');let f=s.canvas.frames.find(x=>x.projectId==='timeline-fixture');if(!f){await s.addProjectFrame('timeline-fixture',30,30);f=window.__store.getState().canvas.frames.find(x=>x.projectId==='timeline-fixture')}s.addComponentNode(f.id,'plugin-panel',20,20,850,680,{pluginId:'eas:timeline',panelId:'main'});s.setViewport({x:0,y:0,scale:.78})})()")
 const newPanel=await connect((await until(async()=>(await newTargets()).find(x=>x.type==='iframe'&&x.url.startsWith('eas-plugin:')))).webSocketDebuggerUrl)
 await until(()=>newPanel.eval("document.querySelector('#monthSummary')?.textContent.includes('1 项')"))
 const state=await newPanel.eval("rpc('panel/state',{})")
 check(state.enabled===true,'real app restart restores global enabled state')
 check(state.excluded.includes('project-b'),'real app restart restores excluded projects')
 checks.push('real app restart retains persisted milestone in heatmap')
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2))
}catch(e){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e)},null,2));console.error(e);process.exitCode=1}finally{for(const ws of sockets)ws.close();child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');for(const dir of [profile,fixture,fixtureB])await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
