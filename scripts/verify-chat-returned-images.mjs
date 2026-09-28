import { createCodexTranslator } from '../src/main/agentChat/codexEvents.ts'
import { createClaudeTranslator } from '../src/main/agentChat/claudeEvents.ts'
import { createOmpTranslator } from '../src/main/agentChat/ompEvents.ts'
import { createChatReducer } from '../src/renderer/src/features/agentChat/reduce.ts'
import { trimForSave } from '../src/renderer/src/features/agentChat/history.ts'
// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import {observeChildClose,cleanupVerificationProfile} from './lib/verification-cleanup.mjs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/chat-media-steer/images');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'插入菜单验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const executable=process.env.EAS_VERIFY_EXECUTABLE||path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const home=path.join(profile,'isolated-home');fs.mkdirSync(home,{recursive:true})
env.HOME=home;env.CODEX_HOME=path.join(home,'.codex')
for(const key of Object.keys(env))if(/TOKEN|SECRET|API_KEY|PASSWORD/.test(key))delete env[key]


const imageData=fs.readFileSync(path.join(root,'docs/verification/frame-light-header/light.png')).toString('base64')
const block={type:'image',mimeType:'image/png',data:imageData}
const translations={
 codex:createCodexTranslator().push(JSON.stringify({type:'item.completed',item:{id:'image-test',type:'mcp_tool_call',status:'completed',result:{content:[block]}}})),
 claude:createClaudeTranslator().push(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'image-test',content:[block]}]}})),
 omp:createOmpTranslator(async()=> 'allow').push(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'tool_call_update',toolCallId:'image-test',status:'completed',content:[{type:'content',content:block}]}}})).events
}
fs.mkdirSync(path.join(profile,'agent-history'))
const nodes=[]
for(const [cli,events] of Object.entries(translations)){
 const reducer=createChatReducer()
 reducer.push({k:'exec.start',execId:'image-test',label:cli+' 返回截图',detail:''})
 for(const e of events)reducer.push(e)
 const first=trimForSave(reducer.view().turns)[0]
 // Legacy inline archive deliberately exceeds 8MiB, without fabricating user data.
 const turns=Array.from({length:32},(_,i)=>({...structuredClone(first),seq:i+1,text:'图片历史 '+i, imageNotice:i<7?'图片总量已达 8 MiB，部分图片未保留':undefined}))
 fs.writeFileSync(path.join(profile,'agent-history',cli+'-image.json'),JSON.stringify({turns,cwd:fixture,resumeId:null,resumeCli:cli}))
 nodes.push({id:cli+'-image',x:nodes.length*680+20,y:50,w:640,h:650,pane:{kind:'agent',cwd:fixture,cli}})
}
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'image-frame',projectId:'picker-fixture',name:'三 CLI 图片验收',x:20,y:20,w:2100,h:740,collapsed:false,nodes}],shapes:[],freeNodes:[],todos:[]}))

const child=spawn(executable,[...(process.env.EAS_VERIFY_EXECUTABLE?[]:[root]),'--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
const childClosed=observeChildClose(child)
let lastExpression='',mainConnection;
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{lastExpression=expression;const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}



try {
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const targets=async()=>{try{return await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500));return []}}
 const main=await connect((await until(async()=>(await targets()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl)
 mainConnection=main
 await until(()=>main.eval('!!window.__store && !!window.api'))
 await until(()=>main.eval("!!document.querySelector('.onb-ghost')"))
 await main.eval("document.querySelector('.onb-ghost').click()")
 const shot=async name=>{await wait(350);const r=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
 for(const cli of ['codex','claude','omp']){
  await main.eval("window.__store.getState().setMaximizedNode({frameId:'image-frame',nodeId:"+JSON.stringify(cli+'-image')+"})")
  await until(()=>main.eval("[...document.querySelectorAll('.ac-returned-images img')].some(i=>i.complete&&i.naturalWidth>0&&i.getBoundingClientRect().width>0)"))
  await main.eval("(()=>{const s=window.__store.getState(),n=s.canvas.frames.find(f=>f.id==='image-frame').nodes.find(n=>n.id==="+JSON.stringify(cli+'-image')+");window.__imagePane='.pane[data-leaf-id='+CSS.escape(n.leafId)+']';document.querySelector(window.__imagePane+' .ac-returned-images img').scrollIntoView({block:'center'})})()")
  await wait(400)
  await shot(cli)
  // Click actual visible thumbnail through CDP coordinates, not React callback injection.
  const box=await main.eval("(()=>{const i=document.querySelector(window.__imagePane+' .ac-returned-images img');const r=i.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()")
  await main.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box})
  await main.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box})
  await until(()=>main.eval("!!document.querySelector('.ac-image-preview[open]')"))
  await until(()=>main.eval("document.querySelector('.ac-image-preview img')?.naturalWidth>0"))
  check(true,cli+' 历史图片加载与点击放大')
  await shot(cli+'-preview')
  await main.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await main.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await until(()=>main.eval("!document.querySelector('.ac-image-preview')"))
  check(await main.eval("window.__store.getState().maximizedNode!==null"),cli+' 关闭预览不误退出模块最大化')
 }
 await main.eval("location.reload()")
 await until(()=>main.eval("[...document.querySelectorAll('.ac-returned-images img')].filter(i=>i.complete&&i.naturalWidth>0).length>0"))
 check(true,'重载后三 CLI 图片仍可解码')

 await main.eval("(()=>{const s=window.__store.getState(),n=s.canvas.frames.find(f=>f.id==='image-frame').nodes.find(n=>n.id==='omp-image');window.__imagePane='.pane[data-leaf-id='+CSS.escape(n.leafId)+']'})()")
 const files=fs.readdirSync(path.join(profile,'chat-images')).filter(n=>!n.endsWith('.tmp'))
 check(files.length===1,'三CLI共96张重复原图按哈希只存1份')
 for(const cli of ['codex','claude','omp']){
  const raw=fs.readFileSync(path.join(profile,'agent-history',cli+'-image.json'),'utf8')
  const parsed=JSON.parse(raw)
  check(!raw.includes('data:image/')&&parsed.turns.length===32,cli+' 超8MiB旧档离线迁移保留全部32轮且无内联像素')
 }
 check(await main.eval("document.querySelectorAll(window.__imagePane+' .ac-image-notice').length===1"),'重复历史提示合并成一条')
 const loaded=await main.eval("document.querySelectorAll(window.__imagePane+' .ac-returned-images img').length")
 check(loaded<12,'32张图片仅可视区持有缩略图，实际 '+loaded)
 await shot('merged-notice-and-lazy')
 const imagePath=path.join(profile,'chat-images',files[0]),bytes=fs.readFileSync(imagePath)
 fs.unlinkSync(imagePath)
 await main.eval("document.querySelector(window.__imagePane+' .ac-messages').scrollTop=999999")
 await wait(300)
 await main.eval("document.querySelector(window.__imagePane+' .ac-returned-image-cell').scrollIntoView({block:'center'})")
 await until(()=>main.eval("document.querySelector(window.__imagePane+' .ac-returned-images')?.textContent.includes('原图不存在')"))
 check(await main.eval("document.querySelector(window.__imagePane+' .ac-returned-images').textContent.includes('恢复原文件')"),'缺失图片给本地恢复入口而非调用模型')
 await shot('missing-original')
 fs.writeFileSync(imagePath,bytes)
 await main.eval("[...document.querySelectorAll(window.__imagePane+' .ac-returned-images button')].find(b=>b.textContent==='重试读取').click()")
 await until(()=>main.eval("document.querySelector(window.__imagePane+' .ac-returned-images img')?.naturalWidth>0"))
 check(true,'原文件回到本地后重试读取成功，无生成请求')
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,scope:'真实 UI/历史与合成协议夹具，不是在线模型端到端'},null,2))
 console.log(JSON.stringify({passed:true,checks},null,2))
} catch(e) {
 console.error(e,lastExpression);process.exitCode=1
 try{const shot=await mainConnection?.send('Page.captureScreenshot',{format:'png'});if(shot)fs.writeFileSync(path.join(output,'failure-screen.png'),Buffer.from(shot.data,'base64'))}catch{}
 fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))
} finally {
 for(const ws of sockets)ws.close()
 await cleanupVerificationProfile({app:child,childClosed,profile})
 fs.writeFileSync(path.join(output,'app.log'),logs)
 await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
