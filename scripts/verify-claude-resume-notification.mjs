// Isolated Electron + fake `claude` replaying the order recorded from Claude Code 2.1.283 on
// 2026-09-28 when resuming a session whose background task was killed: task_notification(stopped),
// an EMPTY self-initiated result (origin.kind=task-notification), and only then the answer to the
// user's waking message. Before the fix the empty result ended the user's turn ("完成" with no reply).
// No account, model or installed app involved.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {observeChildClose,cleanupVerificationProfile} from './lib/verification-cleanup.mjs'

const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-claude-resume-'))
const home=path.join(temp,'home'),profile=path.join(temp,'profile'),cwd=path.join(temp,'project'),bin=path.join(home,'.local','bin'),log=path.join(temp,'fake.jsonl')
const output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/claude-resume-notification')
for(const dir of [home,profile,cwd,bin,output])fs.mkdirSync(dir,{recursive:true})
fs.rmSync(path.join(output,'result.json'),{force:true});fs.rmSync(path.join(output,'failure.json'),{force:true})
fs.writeFileSync(path.join(bin,'claude'),`#!${process.execPath}
const fs=require('node:fs'),readline=require('node:readline')
const argv=process.argv.slice(2),log=process.env.EAS_FAKE_CLAUDE_LOG
if(argv.includes('--version')){process.stdout.write('2.1.283 (Claude Code)\\n');process.exit(0)}
if(argv[0]==='auth'){process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'})+'\\n');process.exit(0)}
const sid='fake-resume-session',send=m=>process.stdout.write(JSON.stringify({...m,session_id:sid})+'\\n')
const note=x=>log&&fs.appendFileSync(log,JSON.stringify({...x,at:Date.now()})+'\\n')
const result=(t,extra={})=>({type:'result',subtype:'success',is_error:false,result:t,num_turns:1,usage:{input_tokens:10,output_tokens:2},total_cost_usd:0.001,...extra})
note({method:'spawn',argv})
let notified=false,pending=[]
const answer=()=>{for(const m of pending.splice(0)){setTimeout(()=>{send({type:'system',subtype:'init',model:'claude-haiku-4-5',cwd:process.cwd()});send({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'PONG'}]}});send(result('PONG'));note({method:'user-result'})},1500)}}
// Recorded order: the stopped-task notification turn comes first, before the user's message is answered.
setTimeout(()=>{
 send({type:'system',subtype:'task_notification',task_id:'by7p2jg93',tool_use_id:'toolu_bg',status:'stopped',output_file:'',summary:"Background shell command didn't finish before the previous session ended"})
 send({type:'system',subtype:'init',model:'claude-haiku-4-5',cwd:process.cwd()})
 send(result('',{origin:{kind:'task-notification'}}))
 note({method:'notification-result'});notified=true;answer()
},400)
readline.createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return};if(m.type!=='user')return;note({method:'user',content:m.message?.content});pending.push(m);if(notified)answer()})
`)
fs.chmodSync(path.join(bin,'claude'),0o755)
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'rs',name:'恢复会话验收',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'rs-frame',projectId:'rs',name:'恢复会话验收',x:20,y:20,w:1100,h:740,collapsed:false,nodes:[{id:'rs-chat',x:20,y:50,w:1000,h:640,pane:{kind:'agent',cwd,cli:'claude'}}]}],shapes:[],freeNodes:[],todos:[]}))
const env={...process.env,HOME:home,EAS_VERIFY:'1',EAS_FAKE_CLAUDE_LOG:log,PATH:bin+':'+process.env.PATH}
for(const key of Object.keys(env))if(key.startsWith('EAS_TERM_')||key.startsWith('EAS_CAPABILITY_')||key.startsWith('CLAUDE')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(key))delete env[key]
let app,childClosed,mainConnection,logs='',lastExpression='';const sockets=[],checks=[],timeline=[]
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn,tries=300){for(let i=0;i<tries;i++){const value=await fn();if(value)return value;await wait(100)}throw Error('Timed out: '+lastExpression)}
async function connect(url){
 const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.onopen=r)
 let id=0;const pending=new Map()
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'))},30000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}))})
 return {send,eval:async expression=>{lastExpression=expression;const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}}
}
const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
try{
 app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--use-mock-keychain','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
 childClosed=observeChildClose(app);app.stdout.on('data',b=>logs+=b);app.stderr.on('data',b=>logs+=b)
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return null}})
 const target=await until(async()=>{let pages;try{pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()}catch{return null};return pages.find(x=>x.type==='page'&&x.title==='Eas-Term'&&x.url.startsWith('file:'))})
 const main=await connect(target.webSocketDebuggerUrl);mainConnection=main;await main.send('Runtime.enable');await until(()=>main.eval('!!window.__store&&!!window.api?.agentChat'))
 for(let i=0;i<30;i++){if(await main.eval("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('先跳过，我自己来'))||document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 const shot=async name=>{const r=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
 const record=async sid=>{const x=await main.eval('window.api.agentChat.listSessions().then(xs=>xs.find(x=>x.id==='+JSON.stringify(sid)+'))');return {busy:x?.busy}}
 const ui=sid=>main.eval("(()=>{const s=window.__store.getState();return {busyHint:document.querySelector('.ac-busy-hint')?.textContent?.trim()||'',running:s.runningPtys.includes("+JSON.stringify(sid)+"),attention:s.attentionPtys.includes("+JSON.stringify(sid)+"),pong:document.body.textContent.includes('PONG')}})()")
 const result=await main.eval('window.api.agentChat.start('+JSON.stringify({cli:'claude',cwd,message:'在吗',agentNodeId:'rs-chat'})+')')
 assert.equal(result.ok,true,JSON.stringify(result));const sid=result.sessionId
 await main.eval("(()=>{const s=window.__store.getState(),n=s.canvas.frames.find(f=>f.id==='rs-frame').nodes.find(n=>n.id==='rs-chat');if(n.leafId){const has=r=>r.id===n.leafId||(r.children||[]).some(has);s.setAgentSessionId(s.tabs.find(t=>has(t.root)).id,n.leafId,"+JSON.stringify(sid)+")}else s.setNodeAgentSession('rs-frame','rs-chat',"+JSON.stringify(sid)+");return true})()")
 // ① 空的通知轮次已到、用户消息还没回答：必须仍在运行，不能标完成
 await until(()=>calls().some(x=>x.method==='notification-result'))
 await wait(700)
 const mid=await ui(sid),midRec=await record(sid);timeline.push({phase:'after-empty-notification-result',ui:mid,record:midRec})
 await shot('1-after-empty-notification')
 assert.equal(mid.pong,false,'fake 尚未回答')
 assert.equal(midRec.busy,true,'空的通知轮次不能结束用户那一轮（busy 被提前收掉）')
 assert.equal(mid.running,true,'全局状态应仍为运行中');assert.equal(mid.attention,false,'不能在没回答时标「完成」')
 assert.ok(mid.busyHint.includes('正在处理'),'对话区应仍显示「正在处理…」：'+mid.busyHint)
 checks.push('后台补报的空一轮到达后，用户那一轮仍在运行：显示「正在处理…」，未标完成')
 // ② 真正的回答
 await until(()=>calls().some(x=>x.method==='user-result'))
 await until(async()=>(await ui(sid)).attention)
 const end=await ui(sid),endRec=await record(sid);timeline.push({phase:'answered',ui:end,record:endRec})
 await shot('2-answered')
 assert.equal(end.pong,true,'回答显示在界面上');assert.equal(endRec.busy,false);assert.equal(end.running,false)
 assert.equal(calls().filter(x=>x.method==='user').length,1,'用户不需要重发')
 checks.push('回答到达后才结束并标完成；用户只发了一次')
 const out={passed:true,checks,timeline,realApp:true,realCli:false,cliEventsRecordedFrom:'Claude Code 2.1.283 resume probe (2026-09-28)',realModel:false}
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2))
}catch(e){try{const s=await mainConnection?.send('Page.captureScreenshot',{format:'png'});if(s)fs.writeFileSync(path.join(output,'failure-screen.png'),Buffer.from(s.data,'base64'))}catch{};fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(e),checks,timeline,calls:calls()},null,2));console.error(String(e));process.exitCode=1}
finally{for(const ws of sockets)ws.close();if(app&&childClosed)await cleanupVerificationProfile({app,childClosed,profile:temp})}
