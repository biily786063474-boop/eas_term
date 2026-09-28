// Isolated Electron + fake `claude` that replays the stream-json sequence recorded from
// Claude Code 2.1.283 on 2026-09-28 (run_in_background shell: result first, shell still
// running, then the CLI wakes itself for a second turn). No real account, model or installed app.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {observeChildClose,cleanupVerificationProfile} from './lib/verification-cleanup.mjs'

const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-claude-bg-'))
const home=path.join(temp,'home'),profile=path.join(temp,'profile'),cwd=path.join(temp,'project'),bin=path.join(home,'.local','bin'),log=path.join(temp,'fake.jsonl')
const output=path.join(root,'docs/verification/claude-background-running')
for(const dir of [home,profile,cwd,bin,output])fs.mkdirSync(dir,{recursive:true})
fs.rmSync(path.join(output,'result.json'),{force:true})
const BG_MS=Number(process.env.EAS_FAKE_BG_MS||7000)
fs.writeFileSync(path.join(bin,'claude'),`#!${process.execPath}
const fs=require('node:fs'),readline=require('node:readline')
const argv=process.argv.slice(2),log=process.env.EAS_FAKE_CLAUDE_LOG
if(argv.includes('--version')){process.stdout.write('2.1.283 (Claude Code)\\n');process.exit(0)}
if(argv[0]==='auth'){process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'})+'\\n');process.exit(0)}
const sid='fake-bg-session',send=m=>process.stdout.write(JSON.stringify({...m,session_id:sid})+'\\n')
const note=x=>log&&fs.appendFileSync(log,JSON.stringify({...x,at:Date.now()})+'\\n')
const at=(ms,fn)=>setTimeout(fn,ms)
const text=(t)=>({type:'assistant',message:{role:'assistant',content:[{type:'text',text:t}]}})
const result=(t,extra={})=>({type:'result',subtype:'success',is_error:false,result:t,num_turns:1,usage:{input_tokens:10,output_tokens:2},total_cost_usd:0.001,...extra})
const task={task_id:'b9o183asg',task_type:'local_bash',description:'sleep 25; echo BGDONE'}
note({method:'spawn',argv})
readline.createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line)}catch{return}
 if(m.type!=='user')return
 note({method:'user',content:m.message?.content})
 send({type:'system',subtype:'init',model:'claude-haiku-4-5',cwd:process.cwd()})
 at(300,()=>{
  send({type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id:'toolu_bg',name:'Bash',input:{command:'sleep 25; echo BGDONE',run_in_background:true}}]}})
  send({type:'system',subtype:'background_tasks_changed',tasks:[task]})
  send({type:'system',subtype:'task_started',task_id:task.task_id,tool_use_id:'toolu_bg',description:task.description,is_backgrounded:true,task_type:'local_bash'})
  send({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_bg',content:'Command running in background with ID: b9o183asg',is_error:false}]}})
  send(text('两台模拟器上的测试还在跑，跑完会自动通知我。'))
  send(result('STARTED'))
  note({method:'first-result'})
 })
 at(300+${BG_MS},()=>{
  send({type:'system',subtype:'background_tasks_changed',tasks:[]})
  send({type:'system',subtype:'task_updated',task_id:task.task_id,patch:{status:'completed'}})
  send({type:'system',subtype:'task_notification',task_id:task.task_id,tool_use_id:'toolu_bg',status:'completed',summary:'Background command completed (exit code 0)'})
  send({type:'system',subtype:'init',model:'claude-haiku-4-5',cwd:process.cwd()})
  note({method:'wake'})
 })
 at(300+${BG_MS}+2500,()=>{send(text('后台测试已全部跑完。'));send(result('FINISHED',{origin:{kind:'task-notification'}}));note({method:'second-result'})})
})
`)
fs.chmodSync(path.join(bin,'claude'),0o755)
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'bg',name:'后台任务验收',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'bg-frame',projectId:'bg',name:'后台任务验收',x:20,y:20,w:1100,h:740,collapsed:false,nodes:[{id:'bg-chat',x:20,y:50,w:1000,h:640,pane:{kind:'agent',cwd,cli:'claude'}}]}],shapes:[],freeNodes:[],todos:[]}))

const env={...process.env,HOME:home,EAS_VERIFY:'1',EAS_FAKE_CLAUDE_LOG:log,PATH:bin+':'+process.env.PATH}
for(const key of Object.keys(env))if(key.startsWith('EAS_TERM_')||key.startsWith('EAS_CAPABILITY_')||key.startsWith('CLAUDE')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(key))delete env[key]
let app,childClosed,mainConnection,logs='',lastExpression='';const sockets=[],checks=[],timeline=[]
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn,tries=450){for(let i=0;i<tries;i++){const value=await fn();if(value)return value;await wait(100)}throw Error('Timed out: '+lastExpression)}
async function connect(url){
 const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.onopen=r)
 let id=0;const pending=new Map()
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p){if(m.method==='Runtime.exceptionThrown'||m.method==='Inspector.targetCrashed')logs+='\nCDP '+JSON.stringify(m);return;}clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'))},30000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}))})
 return {send,eval:async expression=>{lastExpression=expression;const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}}
}
const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
try{
 app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
 childClosed=observeChildClose(app)
 app.on('error',e=>{logs+='\nspawn: '+String(e)})
 app.stdout.on('data',b=>logs+=b);app.stderr.on('data',b=>logs+=b)
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return null}})
 const target=await until(async()=>{let pages;try{pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()}catch{return null};return pages.find(x=>x.type==='page'&&x.title==='Eas-Term'&&x.url.startsWith('file:'))})
 const main=await connect(target.webSocketDebuggerUrl);mainConnection=main;await main.send('Runtime.enable');await until(()=>main.eval('!!window.__store&&!!window.api?.agentChat'))
 if(await main.eval("!!document.querySelector('.onb-ghost')"))await main.eval("document.querySelector('.onb-ghost').click()")
 const shot=async name=>{const r=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
 const record=async sid=>{const x=await main.eval('window.api.agentChat.listSessions().then(xs=>xs.find(x=>x.id==='+JSON.stringify(sid)+'))');return {busy:x?.busy,bgTask:!!x?.bgTask}}
 const ui=sid=>main.eval("(()=>{const s=window.__store.getState(),root=document.querySelector('.ac-messages')||document;return {busyHint:document.querySelector('.ac-busy-hint:not(.ac-bg-hint)')?.textContent?.trim()||'',bgHint:document.querySelector('.ac-bg-hint')?.textContent?.trim()||'',running:s.runningPtys.includes("+JSON.stringify(sid)+"),attention:s.attentionPtys.includes("+JSON.stringify(sid)+"),stop:!!document.querySelector('[aria-label=\"停止生成\"]')}})()")
 const result=await main.eval('window.api.agentChat.start('+JSON.stringify({cli:'claude',cwd,message:'用后台跑一下两台模拟器上的测试',agentNodeId:'bg-chat'})+')')
 assert.equal(result.ok,true,JSON.stringify(result));const sid=result.sessionId
 await main.eval("(()=>{const s=window.__store.getState(),n=s.canvas.frames.find(f=>f.id==='bg-frame').nodes.find(n=>n.id==='bg-chat');if(n.leafId){const has=r=>r.id===n.leafId||(r.children||[]).some(has);s.setAgentSessionId(s.tabs.find(t=>has(t.root)).id,n.leafId,"+JSON.stringify(sid)+")}else s.setNodeAgentSession('bg-frame','bg-chat',"+JSON.stringify(sid)+");return true})()")

 // ① 本轮 result 已到、后台 shell 还在跑
 await until(()=>calls().some(x=>x.method==='first-result'))
 await until(async()=>(await ui(sid)).bgHint.includes('后台任务运行中'))
 const mid=await ui(sid),midRec=await record(sid);timeline.push({phase:'background',ui:mid,record:midRec})
 assert.equal(midRec.busy,false,'本轮已结束，会话不该是 busy');assert.equal(midRec.bgTask,true,'主进程应记下后台任务（空闲回收按「在等后台」算）')
 assert.ok(mid.bgHint.includes('sleep 25; echo BGDONE'),'提示里应带后台命令：'+mid.bgHint)
 assert.equal(mid.busyHint,'','不该同时显示「正在处理…」');assert.equal(mid.stop,false,'后台运行期间不是本轮进行中，不出停止键')
 assert.equal(mid.running,true,'全局状态（灵动岛/侧栏/看板）应为运行中');assert.equal(mid.attention,false,'后台还在跑，不能标「完成」')
 assert.ok(await main.eval("document.body.textContent.includes('跑完会自动通知我')"))
 await shot('1-background-running')
 checks.push('本轮 result 后后台 shell 仍在跑：对话区显示「后台任务运行中 + 命令」，全局状态为运行中、未标完成，发送键不是停止键')
 await wait(1500)
 const still=await ui(sid);assert.equal(still.attention,false);assert.equal(still.running,true)
 checks.push('后台运行 1.5 秒后仍保持运行中，没有被迟到的完成提示覆盖')

 // ② 后台跑完，CLI 自己起的那一轮
 await until(()=>calls().some(x=>x.method==='wake'))
 await until(async()=>(await ui(sid)).busyHint.includes('正在处理'))
 const wake=await ui(sid),wakeRec=await record(sid);timeline.push({phase:'wake',ui:wake,record:wakeRec})
 assert.equal(wake.bgHint,'','后台列表清空后不再显示后台提示');assert.equal(wake.running,true);assert.equal(wake.attention,false)
 assert.equal(wakeRec.busy,true,'CLI 自发的一轮应被当作一轮进行中');assert.equal(wakeRec.bgTask,false)
 await shot('2-wake-turn-running')
 checks.push('后台跑完后 CLI 自己接着说的那一轮显示「正在处理…」，仍为运行中')

 // ③ 真正结束
 await until(()=>calls().some(x=>x.method==='second-result'))
 await until(async()=>(await ui(sid)).attention)
 const end=await ui(sid),endRec=await record(sid);timeline.push({phase:'done',ui:end,record:endRec})
 assert.equal(end.busyHint,'');assert.equal(end.bgHint,'');assert.equal(end.running,false);assert.equal(endRec.busy,false);assert.equal(endRec.bgTask,false)
 assert.ok(await main.eval("document.body.textContent.includes('后台测试已全部跑完')"))
 await shot('3-finished')
 checks.push('自发那一轮结束后才标完成（attention），运行中与后台提示都撤下')
 assert.equal(calls().filter(x=>x.method==='user').length,1,'全程只有用户那一条消息，没有替用户重发')
 checks.push('全程 CLI 只收到用户那一条消息')
 const out={passed:true,checks,timeline,realApp:true,realCli:false,cliEventsRecordedFrom:'Claude Code 2.1.283 (2026-09-28 probe)',realModel:false}
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(out,null,2))
 console.log(JSON.stringify(out,null,2))
}catch(e){try{const shot=await mainConnection?.send('Page.captureScreenshot',{format:'png'});if(shot)fs.writeFileSync(path.join(output,'failure-screen.png'),Buffer.from(shot.data,'base64'))}catch{};fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(e),lastExpression,checks,timeline,calls:calls().slice(-30)},null,2));throw e}
finally{for(const ws of sockets)ws.close();if(app&&childClosed)await cleanupVerificationProfile({app,childClosed,profile:temp});fs.writeFileSync(path.join(output,'app.log'),logs)}
