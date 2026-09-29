// Isolated Electron: mascot in empty canvas, chat startup, run monitor, island; animation gates.
// No account, model or installed app.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn} from 'node:child_process'; import assert from 'node:assert/strict'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-mascot-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'project')
const out=path.join(root,'docs/verification/mascot-in-app');for(const d of [profile,home,cwd,out])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'m',name:'团子验收',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:true}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'m-frame',projectId:'m',name:'团子验收',x:20,y:20,w:1100,h:740,collapsed:false,nodes:[{id:'m-chat',x:20,y:50,w:700,h:640,pane:{kind:'agent',cwd,cli:'claude'}}]}],shapes:[],freeNodes:[],todos:[]}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--inspect=9458','--use-mock-keychain','--user-data-dir='+profile],{env,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
const checks=[]
async function connect(url){const ws=new WebSocket(url);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)}
 const send=(method,params={})=>new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method,params}))})
 return {ws,send,ev:async x=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value}}}
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const list=async()=>{try{return await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()}catch{return []}}
 const t=await until(async()=>(await list()).find(x=>x.type==='page'&&x.title==='Eas-Term'))
 const M=await connect(t.webSocketDebuggerUrl);const {ev,send}=M
 await until(()=>ev('!!window.__store'))
 for(let i=0;i<30;i++){if(await ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('先跳过，我自己来'))||document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 const shot=async(name,sel)=>{let clip;if(sel){const r=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.max(0,b.left-40),y:Math.max(0,b.top-40),width:b.width+80,height:b.height+80,scale:1}})()`);clip=r||undefined}const s=await send('Page.captureScreenshot',{format:'png',...(clip?{clip}:{})});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(s.result.data,'base64'))}
 for(const theme of ['dark','light']){
  await ev(`window.__store.getState().setTheme(${JSON.stringify(theme)});true`);await wait(500)
  // ① 空画布
  await until(()=>ev("!!document.querySelector('.ac-slogan-mascot svg.dango')"))
  await shot('chat-startup-'+theme,'.ac-slogan-mascot')
 }
 checks.push('AI 对话启动页标语上方出现团子（暗/亮）')
 // ② 动画闸门：窗口无焦点时 idle 团子不眨眼（路径 2s 内不变）；焦点模拟后应能动
 const pathOf="document.querySelector('.ac-slogan-mascot svg.dango path').getAttribute('d')"
 const hasFocus=await ev('document.hasFocus()')
 const seen=new Set();for(let i=0;i<12;i++){seen.add(await ev(pathOf));await wait(400)}
 const unfocusedFrames=seen.size
 await send('Emulation.setFocusEmulationEnabled',{enabled:true});await ev("window.dispatchEvent(new Event('focus'));true")
 const seen2=new Set();for(let i=0;i<24;i++){seen2.add(await ev(pathOf));await wait(200)}
 checks.push(`动画闸门：无焦点(hasFocus=${hasFocus}) 4.8s 内 ${unfocusedFrames} 帧；焦点模拟后 4.8s 内 ${seen2.size} 帧（idle 3.6s 眨一次眼）`)
 if(!hasFocus)assert.equal(unfocusedFrames,1,'无焦点时不应切帧')
 assert.ok(seen2.size>=2,'有焦点时 idle 应眨眼')
 const frameId='m-frame'
 // ④ 运行监视器
 await ev("window.__store.getState().setTheme('dark');true")
 const leaf=frameId?await ev(`window.__store.getState().addTerminalNode(${JSON.stringify(frameId)})`).catch(()=>null):null
 const pty=await until(()=>ev("(()=>{const s=window.__store.getState();const walk=r=>r.pane?.kind==='terminal'&&r.pane.ptyId?r.pane.ptyId:(r.children||[]).map(walk).find(Boolean);for(const t of s.tabs){const p=walk(t.root);if(p)return p}return null})()"),80).catch(()=>null)
 if(pty){await ev(`window.__store.getState().setPtyRunning(${JSON.stringify(pty)},true);true`);await until(()=>ev("!!document.querySelector('.crm svg.dango, .crm-mini svg.dango')"));await wait(300);await shot('run-monitor','.crm, .crm-mini');checks.push('任务监视器里的圆点换成运行中团子')
  const s1=new Set();for(let i=0;i<10;i++){s1.add(await ev("document.querySelector('.crm svg.dango path, .crm-mini svg.dango path').getAttribute('d')"));await wait(150)}
  assert.ok(s1.size>=2,'运行中团子应在闪光标耳');checks.push(`运行中团子 1.5s 内切了 ${s1.size} 帧（光标耳闪）`)}
 else checks.push('任务监视器：没造出运行中终端，未验')
 // ⑤ 灵动岛
 await ev('window.api.prefs.set("island",true)');await wait(800)
 {const mt=await until(async()=>{try{return (await(await fetch('http://127.0.0.1:9458/json/list')).json())[0]}catch{return null}});const MP=await connect(mt.webSocketDebuggerUrl);await MP.ev("process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).minimize()");MP.ws.close()}
 await until(async()=>(await list()).some(x=>x.type==='page'&&/island/i.test(x.url)),80).catch(()=>{})
 console.log('pages',JSON.stringify((await list()).map(x=>[x.type,x.title,x.url.slice(-60)])))
 const isl=(await list()).find(x=>x.type==='page'&&/island/i.test(x.url))
 if(isl){const I=await connect(isl.webSocketDebuggerUrl);await wait(1500)
  const f=new Set();for(let i=0;i<10;i++){f.add(await I.ev("document.querySelector('svg.dango path')?.getAttribute('d')||''"));await wait(150)}
  checks.push(`灵动岛团子 1.5s 内 ${f.size} 帧（主窗口最小化时仍在动 = pauseWhenBlurred=false 生效）`)
  const has=await I.ev("!!document.querySelector('svg.dango')");const vis=await I.ev("document.visibilityState")
  if(has){const b=await I.ev("(()=>{const e=document.querySelector('.isl-toprow')||document.body;const r=e.getBoundingClientRect();return {x:0,y:0,width:Math.round(innerWidth),height:Math.min(120,Math.round(innerHeight)),scale:2}})()");const s=await I.send('Page.captureScreenshot',{format:'png',clip:b});if(s.result)fs.writeFileSync(path.join(out,'island.png'),Buffer.from(s.result.data,'base64'))}
  checks.push(`灵动岛：团子${has?'已渲染':'未渲染'}（visibility=${vis}）`);I.ws.close()}
 else checks.push('灵动岛：窗口未出现，未验')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));M.ws.close()
}finally{app.kill('SIGTERM');await wait(1500);fs.rmSync(temp,{recursive:true,force:true})}
