// Isolated Electron + fake Codex app-server. No real account, model, or installed app.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'

const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-safe-retry-ui-'))
const home=path.join(temp,'home'),profile=path.join(temp,'profile'),cwd=path.join(temp,'project'),bin=path.join(home,'.local','bin'),log=path.join(temp,'fake.jsonl')
const output=path.join(root,'docs/verification/codex-goal')
for(const dir of [home,profile,cwd,bin,output])fs.mkdirSync(dir,{recursive:true})
const fake=path.join(bin,'codex')
fs.writeFileSync(fake,`#!${process.execPath}
const fs=require('node:fs'),readline=require('node:readline')
if(process.argv.includes('--version')){process.stdout.write('codex-cli 0.156.1\\n');process.exit(0)}
const log=process.env.EAS_FAKE_CODEX_LOG
let thread='thread-0',turn=0,mode='success',healthReads=0
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n')
readline.createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line)}catch{return}
 if(!m.id)return
 if(log)fs.appendFileSync(log,JSON.stringify({method:m.method,params:m.params})+'\\n')
 if(m.method==='initialize')return send({id:m.id,result:{}})
 if(m.method==='config/read')return send({id:m.id,result:{config:{}}})
 if(m.method==='model/list')return send({id:m.id,result:{data:[{id:'fixture-model',displayName:'fixture-model'}]}})
 if(m.method==='thread/start'||m.method==='thread/resume')return send({id:m.id,result:{thread:{id:thread}}})
 if(m.method==='thread/goal/get')return send({id:m.id,result:{goal:null}})
 if(m.method==='account/read')return send({id:m.id,result:{account:{type:'chatgpt'},requiresOpenaiAuth:true,workspaceRouting:mode==='success'&&++healthReads===1?null:{backendOrigin:'https://fixture.invalid'}}})
 if(m.method==='thread/fork'){thread='thread-'+(++turn);return send({id:m.id,result:{thread:{id:thread}}})}
 if(m.method==='turn/start'){
  const id=['a','b','c'][turn];mode=m.params.input?.[0]?.text?.includes('final-case')?'final':m.params.input?.[0]?.text?.includes('stop-case')?'stop':'success'
  send({id:m.id,result:{turn:{id}}})
  setTimeout(()=>send({method:'turn/started',params:{threadId:thread,turn:{id}}}),10)
  setTimeout(()=>{
   if(turn<2||mode==='final')send({method:'turn/completed',params:{threadId:thread,turn:{id,status:'failed',error:{message:'workspace routing discovery timed out'}}}})
   else {send({method:'item/completed',params:{threadId:thread,turnId:id,item:{id:'message',type:'agentMessage',text:'恢复完成',phase:'final_answer'}}});send({method:'turn/completed',params:{threadId:thread,turn:{id,status:'completed'}}})}
  },70)
  return
 }
 send({id:m.id,error:{code:-32601,message:'unknown method'}})
})
`)
fs.chmodSync(fake,0o755)
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'retry',name:'Codex 恢复验收',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'retry-frame',projectId:'retry',name:'Codex 恢复验收',x:20,y:20,w:1100,h:740,collapsed:false,nodes:[{id:'retry-chat',x:20,y:50,w:1000,h:640,pane:{kind:'agent',cwd,cli:'codex'}}]}],shapes:[],freeNodes:[],todos:[]}))

const env={...process.env,HOME:home,CODEX_HOME:path.join(home,'.codex'),EAS_VERIFY:'1',EAS_FAKE_CODEX_LOG:log,PATH:bin+':'+process.env.PATH}
for(const key of Object.keys(env))if(key.startsWith('EAS_TERM_')||key.startsWith('EAS_CAPABILITY_'))delete env[key]
fs.mkdirSync(env.CODEX_HOME,{recursive:true})
let app,logs='',lastExpression='';const sockets=[],checks=[]
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn,tries=450){for(let i=0;i<tries;i++){const value=await fn();if(value)return value;await wait(100)}throw Error('Timed out: '+lastExpression)}
async function connect(url){
 const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.onopen=r)
 let id=0;const pending=new Map()
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'))},30000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}))})
 return {send,eval:async expression=>{lastExpression=expression;const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}}
}
const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
try{
 app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
 app.on('error',e=>{logs+='\nspawn: '+String(e)})
 app.stdout.on('data',b=>logs+=b);app.stderr.on('data',b=>logs+=b)
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return null}})
 const target=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();return pages.find(x=>x.type==='page'&&x.title==='Eas-Term'&&x.url.startsWith('file:'))})
 const main=await connect(target.webSocketDebuggerUrl);await main.send('Runtime.enable');await until(()=>main.eval('!!window.__store&&!!window.api?.agentChat'))
 await until(()=>main.eval("!!document.querySelector('.onb-ghost')"))
 await main.eval("document.querySelector('.onb-ghost').click()")
 await until(()=>main.eval("!document.querySelector('.onb-ghost')"))
 const shot=async name=>{const r=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
 const state=sid=>main.eval('window.api.agentChat.listSessions().then(xs=>xs.find(x=>x.id==='+JSON.stringify(sid)+'))')
 const hint=()=>main.eval("document.querySelector('.ac-busy-hint')?.textContent?.trim()||''")
 const pointers=()=>main.eval("(()=>{const s=window.__store.getState();const n=s.canvas.frames.find(f=>f.id==='retry-frame').nodes.find(n=>n.id==='retry-chat');const leaves=[];const walk=r=>{if(r.pane?.kind==='agent')leaves.push({id:r.id,resumeId:r.pane.resumeId,sessionId:r.pane.sessionId});for(const c of r.children||[])walk(c)};for(const t of s.tabs)walk(t.root);return {node:n.pane,leafId:n.leafId,leaves}})()")
 const events=sid=>main.eval('window.__safeEvents['+JSON.stringify(sid)+']||[]')
 async function start(message,capture=false){
  const result=await main.eval('window.api.agentChat.start('+JSON.stringify({cli:'codex',cwd,message,model:'fixture-model',sandbox:'read-only'})+')')
  assert.equal(result.ok,true,JSON.stringify(result));const sid=result.sessionId
  // A preload subscriber drains buffered events; use it only for the IPC-only
  // scenarios, never before the visible pane has attached in the UI scenario.
  if(capture)await main.eval('(()=>{window.__safeEvents||={};window.__safeEvents['+JSON.stringify(sid)+']=[];window.api.agentChat.onEvent('+JSON.stringify(sid)+',e=>window.__safeEvents['+JSON.stringify(sid)+'].push(e));return true})()')
  await main.eval("(()=>{const s=window.__store.getState(),n=s.canvas.frames.find(f=>f.id==='retry-frame').nodes.find(n=>n.id==='retry-chat');if(n.leafId){const has=r=>r.id===n.leafId||(r.children||[]).some(has);s.setAgentSessionId(s.tabs.find(t=>has(t.root)).id,n.leafId,"+JSON.stringify(sid)+")}else s.setNodeAgentSession('retry-frame','retry-chat',"+JSON.stringify(sid)+");return true})()")
  return sid
 }
 const sid=await start('success-case')
 await until(async()=>/恢复（1\/2）/.test(await hint()));await shot('safe-retry-1-of-2');checks.push('first recovery hint visible in real Electron')
 await until(async()=>/恢复（2\/2）/.test(await hint()));await shot('safe-retry-2-of-2');checks.push('second recovery hint visible in real Electron')
 await until(async()=>(await state(sid))?.busy===false);await until(()=>main.eval("document.body.textContent.includes('恢复完成')"));await shot('safe-retry-completed')
 // This harness starts through IPC rather than the compose box, so it does not
 // create the renderer's optimistic user turn; native recovery must not invent one.
 assert.equal(await main.eval("document.querySelectorAll('.ac-turn-user').length"),0)
 assert((await pointers()).leaves.some(x=>x.sessionId===sid&&x.resumeId==='thread-2'))
 assert.equal(calls().filter(x=>x.method==='turn/start').length,3)
 assert.deepEqual(calls().filter(x=>x.method==='thread/fork').map(x=>x.params.beforeTurnId),['a','b'])
 assert.equal(calls().filter(x=>x.method==='account/read').length,3)
 checks.push('health miss then recovery, no synthetic duplicate user turn, two beforeTurnId forks, three paid starts, final resumeId')
 const stopSid=await start('stop-case',true)
 await until(async()=>(await events(stopSid)).some(x=>x.k==='retry.status'&&x.attempt===1));await main.eval('window.api.agentChat.interrupt('+JSON.stringify(stopSid)+')')
 await until(async()=>(await state(stopSid))?.busy===false);await wait(5500)
 const stopStarts=calls().filter(x=>x.method==='turn/start'&&x.params.input?.[0]?.text==='stop-case')
 assert.equal(stopStarts.length,1);checks.push('user stop during backoff did not submit retry')
 const finalSid=await start('final-case',true)
 await until(async()=>(await state(finalSid))?.busy===false)
 const finalEvents=await events(finalSid)
 assert.deepEqual(finalEvents.filter(x=>x.k==='retry.status').map(x=>x.attempt),[1,2])
 assert(finalEvents.some(x=>x.k==='error'&&x.fatal===true))
 assert.equal(calls().filter(x=>x.method==='turn/start'&&x.params.input?.[0]?.text==='final-case').length,3)
 checks.push('third native failure is final and no fourth paid start')
 fs.rmSync(path.join(output,'safe-retry-ui-failure.json'),{force:true})
 console.log(JSON.stringify({passed:true,checks,realApp:true,realCli:false,realModel:false,profile:temp},null,2))
}catch(e){fs.writeFileSync(path.join(output,'safe-retry-ui-failure.json'),JSON.stringify({error:String(e),lastExpression,checks,calls:calls().slice(-30)},null,2));throw e}
finally{for(const ws of sockets)ws.close();app?.kill('SIGKILL');fs.writeFileSync(path.join(output,'safe-retry-app.log'),logs);console.log('isolated profile:',temp)}
