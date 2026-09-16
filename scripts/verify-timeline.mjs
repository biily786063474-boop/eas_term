// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=path.join(root,'docs/verification/timeline');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'timeline-fixture',name:'时间线验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const executable=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,root,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
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
 await until(()=>panel.eval("document.querySelector('#connection')?.textContent.includes('项目内保存')"))
 check(await panel.eval("document.querySelector('#monthSummary').textContent.includes('0 项')"),'real panel starts empty, no fixture UI data')
 check(await panel.eval("document.querySelectorAll('.atmosphere .mote').length===8 && getComputedStyle(document.querySelector('.atmosphere')).pointerEvents==='none'"),'decorative particles present and do not intercept input')
 check(await panel.eval("getComputedStyle(document.querySelector('.mote')).animationName.includes('mote-breathe')"),'particles have independent breathing animation')

 await panel.eval("document.querySelector('#motionToggle').click()")
 check(await panel.eval("[...document.querySelectorAll('.mote')].every(e=>getComputedStyle(e).animationName==='none')"),'reduce motion stops particle drift')
 await panel.eval("document.querySelector('#motionToggle').click()")

 const endpoint=JSON.parse(fs.readFileSync(path.join(profile,'mcp-endpoint.json'),'utf8'))
 const post=async(method,params={},project=fixture)=>await(await fetch('http://127.0.0.1:'+endpoint.port+'/plugin/rpc',{method:'POST',headers:{'content-type':'application/json','x-eas-token':endpoint.token},body:JSON.stringify({plugin:'timeline',shimId:'timeline-verification',project,method,params})})).json()
 check((await post('initialize',{})).ok,'real plugin gateway initializes')
 const now=new Date(),date=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')
 const value={taskKey:'ui-acceptance',title:'真实工具写入时间线',summary:'通过隔离应用网关写入，面板自动刷新，并验证持久化。',date,status:'verified',evidence:['隔离网关与面板联调验证'],author:'验证脚本'}
 const result=await post('tools/call',{name:'timeline_record',arguments:value});check(result.ok&&!result.result.isError,'record through AI gateway succeeds')
 await until(()=>panel.eval("document.querySelector('#monthSummary').textContent.includes('1 项')"));checks.push('AI write notification refreshes mounted panel')
 const retry=await post('tools/call',{name:'timeline_record',arguments:value});check(retry.result.structuredContent.changed===false,'gateway retry idempotent')
 const forbidden=await post('tools/call',{name:'timeline_record',arguments:value},os.tmpdir());check(!forbidden.ok,'host guard rejects unauthorized cwd')
 await panel.eval('document.querySelector(\'[data-day="'+now.getDate()+'"]\').click()')
 await until(()=>panel.eval("document.querySelectorAll('.wheel-item').length===1"));
 for(let i=1;i<=4;i++)await post('tools/call',{name:'timeline_record',arguments:{...value,taskKey:'wheel-fixture-'+i,title:['完成时间轴视觉稿','接通里程碑持久化','验证跨项目隔离','完成省 token 回执检查'][i-1]}})
 await until(()=>panel.eval("document.querySelectorAll('.wheel-item').length===5"));await wait(1100)
 check(await panel.eval("[...document.querySelectorAll('.wheel-item')].some(e=>parseFloat(getComputedStyle(e).filter.match(/blur\\(([\\d.]+)/)?.[1])>=2)"),'off-center wheel items have stepped blur')
 await main.send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(output,'wheel.png'),Buffer.from(r.data,'base64')))
 const before=await panel.eval("[...document.querySelectorAll('.mote')].map(e=>({transform:getComputedStyle(e).transform,opacity:getComputedStyle(e).opacity}))")
 await wait(2200)
 const after=await panel.eval("[...document.querySelectorAll('.mote')].map(e=>({transform:getComputedStyle(e).transform,opacity:getComputedStyle(e).opacity}))")
 check(after.some((v,i)=>v.transform!==before[i].transform && Math.abs(Number(v.opacity)-Number(before[i].opacity))>.03),'particles visibly drift and breathe over time')
 await main.send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(output,'wheel-motion.png'),Buffer.from(r.data,'base64')))

 await panel.eval("document.querySelector('[aria-current=true]').click()")
 await until(()=>panel.eval("document.querySelector('.app').dataset.view==='detail'"));await wait(1150)
 check(await panel.eval("document.querySelector('#taskTitle').textContent==='真实工具写入时间线'"),'title opens persisted detail')
 await main.send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(output,'detail.png'),Buffer.from(r.data,'base64')))
 await panel.eval("document.querySelector('#toDay').click();document.querySelector('#toMonth').click()")
 await until(()=>panel.eval("document.querySelector('#monthSummary').textContent.includes('5 项')"));await wait(1100)
 await main.send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(output,'month.png'),Buffer.from(r.data,'base64')))
 check(JSON.parse(fs.readFileSync(path.join(fixture,'.eas/timeline.json'),'utf8')).items.length===5,'five durable milestones on disk')
 await panel.eval('location.reload()');await until(()=>panel.eval("document.querySelector('#monthSummary')?.textContent.includes('5 项')"));checks.push('panel reload retains milestone')
 console.log(JSON.stringify({passed:true,checks,output},null,2));fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks},null,2))
}catch(e){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e)},null,2));console.error(e);process.exitCode=1}finally{for(const ws of sockets)ws.close();child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');fs.writeFileSync(path.join(output,'app.log'),logs);await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
