// Real Electron/browser zoom, isolated userData and loopback-only test page; no model calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {observeChildClose,cleanupVerificationProfile} from './lib/verification-cleanup.mjs'
const root=process.cwd(),profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-browser-zoom-'))
const output=path.join(root,'docs/verification/browser-max-zoom');fs.mkdirSync(output,{recursive:true})
for(const [name,value] of Object.entries({'prefs.json':{autoUpdateCheck:false,telemetry:false,island:false},'skill-prefs.json':{muted:true},'projects.json':[]}))fs.writeFileSync(path.join(profile,name),JSON.stringify(value))
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><title>网页比例验收</title></head><body style="background:#edf2f6;color:#273747;font:24px system-ui;padding:40px"><h1>网页显示比例</h1><p>最大化后使用地址栏右侧 − / 比例 / ＋</p><p>缩放网页，不移动画布。</p><input placeholder="验证输入与命中位置"></body></html>')})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const url='http://127.0.0.1:'+server.address().port
const env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
const childClosed=observeChildClose(app);let logs='',ws,send,evaluate,last='';const checks=[]
app.stdout.on('data',b=>logs+=b);app.stderr.on('data',b=>logs+=b)
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const until=async fn=>{for(let i=0;i<180;i++){if(app.exitCode!==null)throw Error('App exited');const r=await fn();if(r)return r;await pause(100)}throw Error('Timeout: '+last)}
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const target=await until(async()=>{try{return(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.title==='Eas-Term')}catch{return null}})
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
 let serial=0;const pending=new Map()
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method+' '+last))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})
 evaluate=async expression=>{last=expression;const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}
 await until(()=>evaluate('!!window.__store&&!!window.api'))
 await pause(1000)
 await evaluate("document.querySelector('.onb-ghost')?.click()")
 await evaluate("(()=>{const s=window.__store.getState();s.addProjectFrame(null,100,100);const f=window.__store.getState().canvas.frames.at(-1);s.addWebNode(f.id,"+JSON.stringify(url)+");window.fixture={frameId:f.id,nodeId:window.__store.getState().canvas.frames.at(-1).nodes.at(-1).id};s.setViewport({scale:0.8});s.setMaximizedNode(window.fixture);window.fixtureNode=()=>document.querySelector('[data-node-id=\"'+window.fixture.nodeId+'\"]');window.fixtureWeb=()=>window.fixtureNode()?.querySelector('webview')})()")
 await until(()=>evaluate("(()=>{try{return window.fixtureWeb()?.getURL().startsWith('http://127.0.0.1')}catch{return false}})()"))
 await until(()=>evaluate("!!window.fixtureNode().querySelector('[aria-label=网页显示比例]')"))
 const click=async label=>{
  const box=await evaluate("(()=>{const b=window.fixtureNode().querySelector('[aria-label=\""+label+"\"]');const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()")
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box})
 }
 await click('放大网页');await until(()=>evaluate('Math.abs(window.fixtureWeb().getZoomFactor()-1.15)<0.001'))
 check(await evaluate("window.fixtureNode().querySelector('.web-zoom-pct').textContent==='115%'"),'真实点击放大：比例115%，guest zoomFactor=1.15')
 await shot('maximized-115')
 await click('缩小网页');await until(()=>evaluate('Math.abs(window.fixtureWeb().getZoomFactor()-1)<0.001'))
 await click('缩小网页');await until(()=>evaluate('window.fixtureWeb().getZoomFactor()<0.9'))
 await shot('maximized-87');checks.push('真实点击缩小：比例87%，网页原生重排')
 await click('重置网页比例');await until(()=>evaluate('window.fixtureWeb().getZoomFactor()===1'))
 check(await evaluate('window.__store.getState().canvas.viewport.scale===0.8'),'网页按钮不改变画布比例')
 await click('放大网页');await evaluate("new Promise(resolve=>{const w=window.fixtureWeb();w.addEventListener('dom-ready',()=>resolve(true),{once:true});w.reload()})")
 await until(()=>evaluate('Math.abs(window.fixtureWeb().getZoomFactor()-1.15)<0.001'));checks.push('网页刷新后保持当前比例')
 await evaluate('window.__store.getState().setMaximizedNode(null)');await pause(400)
 check(await evaluate("!window.fixtureNode().querySelector('.web-zoom')&&window.fixtureWeb().getZoomFactor()===1"),'还原画布后隐藏网页比例栏并恢复1倍')
 check(await evaluate("getComputedStyle(document.querySelector('.canvas-zoombar')).opacity==='1'"),'画布原有缩放条恢复')
 await shot('restored-canvas')
 await evaluate("(()=>{const s=window.__store.getState();const node=s.canvas.frames.find(f=>f.id===window.fixture.frameId).nodes.find(n=>n.id===window.fixture.nodeId);window.__store.setState({canvas:{...s.canvas,frames:s.canvas.frames.map(f=>({...f,nodes:f.nodes.filter(n=>n.id!==node.id)})),freeNodes:[...s.canvas.freeNodes,{...node,x:100,y:100}]}});window.fixture={frameId:null,nodeId:node.id};s.setMaximizedNode(window.fixture)})()")
 await until(()=>evaluate("!!window.fixtureNode()?.querySelector('.web-zoom')"))
 await until(()=>evaluate("(()=>{try{return !!window.fixtureWeb()?.getURL()}catch{return false}})()"))
 await click('放大网页');await until(()=>evaluate('Math.abs(window.fixtureWeb().getZoomFactor()-1.15)<0.001'))
 checks.push('自由浏览器节点最大化同样可缩放');await shot('free-node-115')
 fs.rmSync(path.join(output,'failure.json'),{force:true})
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2))
}catch(e){console.error(e);process.exitCode=1;try{await shot('failure')}catch{};fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(e),last,checks},null,2))}
finally{ws?.close();await cleanupVerificationProfile({app,childClosed,profile});fs.writeFileSync(path.join(output,'app.log'),logs);await new Promise(r=>server.close(r))}
